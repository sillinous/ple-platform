/**
 * PLE Chat Widget — Floating AI assistant embed
 * Add to any page: <script src="/chat-widget.js" defer></script>
 * 
 * Features:
 * - Floating button (bottom-right corner)
 * - Expandable chat panel with full AI + KB fallback
 * - Suggested follow-ups after each answer
 * - Markdown rendering via marked.js
 * - Persists conversation across page navigations (sessionStorage)
 * - Respects brand: Fraunces + Inter, Horizon + Dawn palette
 */
(function() {
  'use strict';

  // Don't load on the full chat page
  if (window.location.pathname === '/chat' || window.location.pathname === '/chat.html') return;

  const CHAT_API = '/api/chat';
  const KB_URL = '/data/knowledge-base.json';

  // Follow-up suggestions by topic
  const FOLLOW_UPS = {
    core: ['What is the L/0 symbol?', 'How is PLE different from UBI?', 'Who created this framework?'],
    pyramid_of_prosperity: ['What are the 5 layers?', 'How do property interventions work?', 'Show me real-world examples'],
    pyramid_of_power: ['How does democracy survive automation?', 'What is the Fork Right?', 'Explain the Bedrock layer'],
    attractor_states: ['What is technofeudalism?', 'How do we reach techno-abundance?', 'What is normalcy bias?'],
    four_human_offerings: ['Which offerings are already automated?', 'Is empathy the last frontier?', 'What happens when all four are replaced?'],
    property_interventions: ['What are data royalties?', 'How do credit unions fit in?', 'What is the banking thesis?'],
    economic_agency: ['What are the agency principles?', 'How do I build financial authority?', 'What is time sovereignty?'],
    overview: ['Explain the core thesis', 'What problems does PLE solve?', 'How is this structured optimism?']
  };

  // Default follow-ups
  const DEFAULT_FOLLOW_UPS = [
    'What are the three attractor states?',
    'Explain the 16 property interventions',
    'Show me real-world examples'
  ];

  let isOpen = false;
  let history = [];
  let sending = false;
  let markedLoaded = false;
  let markedLib = null;

  // Restore session
  try {
    const saved = sessionStorage.getItem('ple_chat_history');
    if (saved) history = JSON.parse(saved);
  } catch(e) {}

  // Load marked.js dynamically
  function loadMarked() {
    if (markedLoaded) return Promise.resolve();
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/marked@12/marked.min.js';
      s.onload = () => { markedLib = window.marked; markedLoaded = true; resolve(); };
      s.onerror = () => { markedLoaded = true; resolve(); }; // degrade gracefully
      document.head.appendChild(s);
    });
  }

  function parseMarkdown(text) {
    if (markedLib) return markedLib.parse(text);
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
               .replace(/\n/g, '<br>');
  }

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    #ple-chat-fab {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, #1B4D3E 0%, #2a6b55 100%);
      color: #fff; border: none; cursor: pointer;
      box-shadow: 0 4px 20px rgba(27,77,62,0.35), 0 2px 8px rgba(0,0,0,0.15);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s;
      font-size: 24px;
    }
    #ple-chat-fab:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(27,77,62,0.45); }
    #ple-chat-fab.open { transform: scale(0); pointer-events: none; }
    #ple-chat-fab .fab-badge {
      position: absolute; top: -2px; right: -2px;
      background: #F4A261; color: #1B4D3E; font-size: 10px; font-weight: 700;
      width: 20px; height: 20px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
    }

    #ple-chat-panel {
      position: fixed; bottom: 24px; right: 24px; z-index: 10000;
      width: 400px; height: 560px; max-height: calc(100vh - 48px); max-width: calc(100vw - 48px);
      background: #faf8f5; border-radius: 16px;
      box-shadow: 0 12px 48px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.08);
      display: flex; flex-direction: column; overflow: hidden;
      transform: scale(0.5) translateY(40px); opacity: 0;
      transform-origin: bottom right;
      transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s;
      pointer-events: none;
      font-family: 'Inter', -apple-system, sans-serif;
    }
    #ple-chat-panel.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: auto; }

    .pcw-header {
      background: linear-gradient(135deg, #1B4D3E 0%, #1a5c49 100%);
      color: #fff; padding: 14px 16px; display: flex; align-items: center; gap: 10px;
      flex-shrink: 0;
    }
    .pcw-header-icon {
      width: 32px; height: 32px; background: rgba(255,255,255,0.15);
      border-radius: 8px; display: flex; align-items: center; justify-content: center;
      font-size: 16px; flex-shrink: 0;
    }
    .pcw-header-text h3 { margin: 0; font-family: 'Fraunces', Georgia, serif; font-size: 14px; font-weight: 600; }
    .pcw-header-text p { margin: 2px 0 0; font-size: 11px; opacity: 0.75; }
    .pcw-close {
      margin-left: auto; background: rgba(255,255,255,0.15); border: none;
      color: #fff; width: 28px; height: 28px; border-radius: 6px;
      cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
    }
    .pcw-close:hover { background: rgba(255,255,255,0.25); }

    .pcw-messages {
      flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;
      scroll-behavior: smooth;
    }
    .pcw-messages::-webkit-scrollbar { width: 4px; }
    .pcw-messages::-webkit-scrollbar-thumb { background: #ccc; border-radius: 2px; }

    .pcw-msg {
      max-width: 88%; padding: 10px 13px; border-radius: 12px;
      font-size: 13px; line-height: 1.5; animation: pcwIn 0.25s ease;
    }
    .pcw-msg.user {
      align-self: flex-end; background: #1B4D3E; color: #fff;
      border-bottom-right-radius: 4px;
    }
    .pcw-msg.assistant {
      align-self: flex-start; background: #fff; border: 1px solid #e8e4df;
      border-bottom-left-radius: 4px; color: #333;
    }
    .pcw-msg.assistant h2, .pcw-msg.assistant h3 {
      font-family: 'Fraunces', Georgia, serif; margin: 6px 0 4px; font-size: 13px; color: #1B4D3E;
    }
    .pcw-msg.assistant strong { color: #1B4D3E; }
    .pcw-msg.assistant ul, .pcw-msg.assistant ol { padding-left: 16px; margin: 4px 0; }
    .pcw-msg.assistant li { margin-bottom: 2px; }
    .pcw-msg.assistant p { margin: 4px 0; }
    .pcw-msg.assistant p:first-child { margin-top: 0; }
    .pcw-msg.assistant p:last-child { margin-bottom: 0; }

    .pcw-welcome {
      text-align: center; padding: 24px 16px; color: #888;
    }
    .pcw-welcome h3 { font-family: 'Fraunces', Georgia, serif; color: #1B4D3E; margin: 0 0 8px; font-size: 15px; }
    .pcw-welcome p { font-size: 12px; margin: 0 0 14px; }

    .pcw-starters, .pcw-followups {
      display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;
    }
    .pcw-starter, .pcw-followup {
      background: #fff; border: 1px solid #e0dbd5; padding: 6px 11px;
      border-radius: 8px; font-size: 11.5px; cursor: pointer;
      transition: all 0.2s; color: #444; font-family: 'Inter', sans-serif;
    }
    .pcw-starter:hover, .pcw-followup:hover {
      border-color: #F4A261; background: rgba(244,162,97,0.06); color: #1B4D3E;
    }

    .pcw-followups { padding: 4px 0 8px; }
    .pcw-followup-label {
      font-size: 10px; color: #999; text-align: center; margin: 8px 0 4px;
      font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;
    }

    .pcw-typing {
      align-self: flex-start; padding: 10px 13px; background: #fff;
      border: 1px solid #e8e4df; border-radius: 12px;
      display: flex; gap: 4px; animation: pcwIn 0.25s ease;
    }
    .pcw-typing span {
      width: 5px; height: 5px; background: #F4A261; border-radius: 50%;
      animation: pcwBounce 1.2s infinite;
    }
    .pcw-typing span:nth-child(2) { animation-delay: 0.2s; }
    .pcw-typing span:nth-child(3) { animation-delay: 0.4s; }

    .pcw-input-area {
      padding: 10px 12px; border-top: 1px solid #e8e4df;
      display: flex; gap: 8px; flex-shrink: 0; background: #fff;
      border-radius: 0 0 16px 16px;
    }
    .pcw-input {
      flex: 1; padding: 8px 12px; border: 1.5px solid #e0dbd5;
      border-radius: 10px; font-family: 'Inter', sans-serif; font-size: 13px;
      outline: none; resize: none; min-height: 36px; max-height: 80px;
      transition: border-color 0.2s; background: #faf8f5;
    }
    .pcw-input:focus { border-color: #1B4D3E; }
    .pcw-send {
      background: #1B4D3E; color: #fff; border: none; border-radius: 10px;
      padding: 0 14px; font-weight: 600; cursor: pointer; font-size: 13px;
      transition: opacity 0.2s;
    }
    .pcw-send:hover { opacity: 0.85; }
    .pcw-send:disabled { opacity: 0.35; cursor: not-allowed; }

    .pcw-fallback-note {
      background: rgba(244,162,97,0.1); border-radius: 6px; padding: 6px 8px;
      font-size: 10.5px; color: #888; margin-bottom: 6px;
    }
    .pcw-expand-link {
      display: block; text-align: center; font-size: 11px; color: #1B4D3E;
      text-decoration: none; padding: 6px 0 2px; opacity: 0.7;
      transition: opacity 0.2s;
    }
    .pcw-expand-link:hover { opacity: 1; text-decoration: underline; }

    @keyframes pcwIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @keyframes pcwBounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-4px); } }

    @media (max-width: 480px) {
      #ple-chat-panel { width: calc(100vw - 16px); height: calc(100vh - 80px); right: 8px; bottom: 8px; border-radius: 12px; }
      #ple-chat-fab { bottom: 16px; right: 16px; }
    }
  `;
  document.head.appendChild(style);

  // Create FAB
  const fab = document.createElement('button');
  fab.id = 'ple-chat-fab';
  fab.innerHTML = '💬';
  fab.title = 'Ask the PLE AI Assistant';
  fab.onclick = () => toggle(true);
  document.body.appendChild(fab);

  // Create panel
  const panel = document.createElement('div');
  panel.id = 'ple-chat-panel';
  panel.innerHTML = `
    <div class="pcw-header">
      <div class="pcw-header-icon">L/0</div>
      <div class="pcw-header-text">
        <h3>PLE Assistant</h3>
        <p>AI grounded in the knowledge base</p>
      </div>
      <button class="pcw-close" onclick="window._pleChat.toggle(false)">✕</button>
    </div>
    <div class="pcw-messages" id="pcw-messages"></div>
    <div class="pcw-input-area">
      <textarea class="pcw-input" id="pcw-input" placeholder="Ask about PLE…" rows="1"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window._pleChat.send()}"
        oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,80)+'px'"></textarea>
      <button class="pcw-send" id="pcw-send" onclick="window._pleChat.send()">→</button>
    </div>
    <a class="pcw-expand-link" href="/chat">Open full chat ↗</a>
  `;
  document.body.appendChild(panel);

  const messagesEl = document.getElementById('pcw-messages');
  const inputEl = document.getElementById('pcw-input');
  const sendBtn = document.getElementById('pcw-send');

  function toggle(open) {
    isOpen = typeof open === 'boolean' ? open : !isOpen;
    panel.classList.toggle('open', isOpen);
    fab.classList.toggle('open', isOpen);
    if (isOpen) {
      loadMarked();
      if (history.length === 0) showWelcome();
      else renderHistory();
      setTimeout(() => inputEl.focus(), 350);
    }
  }

  function showWelcome() {
    messagesEl.innerHTML = `
      <div class="pcw-welcome">
        <h3>Explore Post-Labor Economics</h3>
        <p>Ask anything about the PLE framework</p>
        <div class="pcw-starters">
          <button class="pcw-starter" onclick="window._pleChat.ask(this.textContent)">What is PLE?</button>
          <button class="pcw-starter" onclick="window._pleChat.ask(this.textContent)">Three attractor states</button>
          <button class="pcw-starter" onclick="window._pleChat.ask(this.textContent)">16 property interventions</button>
          <button class="pcw-starter" onclick="window._pleChat.ask(this.textContent)">Pyramid of Prosperity</button>
        </div>
      </div>
    `;
  }

  function renderHistory() {
    messagesEl.innerHTML = '';
    for (const msg of history) {
      addBubble(msg.role, msg.content, msg.context, msg.fallback, false);
    }
    // Add follow-ups for last assistant message
    const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
    if (lastAssistant?.context?.sections_used) {
      addFollowUps(lastAssistant.context.sections_used);
    }
    scrollBottom();
  }

  function addBubble(role, content, context, isFallback, animate) {
    const div = document.createElement('div');
    div.className = `pcw-msg ${role}`;
    if (animate !== false) div.style.animation = 'pcwIn 0.25s ease';
    else div.style.animation = 'none';

    if (role === 'assistant') {
      let html = parseMarkdown(content);
      if (isFallback) {
        html = '<div class="pcw-fallback-note">📚 From knowledge base (offline mode)</div>' + html;
      }
      div.innerHTML = html;
    } else {
      div.textContent = content;
    }
    messagesEl.appendChild(div);
  }

  function addFollowUps(sections) {
    const suggestions = [];
    for (const s of sections) {
      const topicFollowUps = FOLLOW_UPS[s] || [];
      for (const f of topicFollowUps) {
        if (!suggestions.includes(f) && suggestions.length < 3) suggestions.push(f);
      }
    }
    if (suggestions.length === 0) {
      suggestions.push(...DEFAULT_FOLLOW_UPS.slice(0, 3));
    }

    // Remove any already-asked questions
    const asked = new Set(history.filter(m => m.role === 'user').map(m => m.content.toLowerCase()));
    const filtered = suggestions.filter(s => !asked.has(s.toLowerCase()));
    if (filtered.length === 0) return;

    const label = document.createElement('div');
    label.className = 'pcw-followup-label';
    label.textContent = 'Continue exploring';
    messagesEl.appendChild(label);

    const wrap = document.createElement('div');
    wrap.className = 'pcw-followups';
    for (const s of filtered) {
      const btn = document.createElement('button');
      btn.className = 'pcw-followup';
      btn.textContent = s;
      btn.onclick = () => { window._pleChat.ask(s); };
      wrap.appendChild(btn);
    }
    messagesEl.appendChild(wrap);
  }

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function send() {
    const msg = inputEl.value.trim();
    if (!msg || sending) return;
    await ask(msg);
  }

  async function ask(msg) {
    if (sending) return;
    sending = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    inputEl.style.height = 'auto';

    // Remove welcome + old follow-ups
    const welcome = messagesEl.querySelector('.pcw-welcome');
    if (welcome) welcome.remove();
    messagesEl.querySelectorAll('.pcw-followup-label, .pcw-followups').forEach(el => el.remove());

    addBubble('user', msg);
    history.push({ role: 'user', content: msg });

    // Typing indicator
    const typing = document.createElement('div');
    typing.className = 'pcw-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(typing);
    scrollBottom();

    try {
      const token = localStorage.getItem('ple_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(CHAT_API, {
        method: 'POST', headers,
        body: JSON.stringify({ message: msg, history: history.slice(-6) })
      });
      const data = await res.json();
      typing.remove();

      if (data.fallback) {
        const fb = await localFallback(msg);
        addBubble('assistant', fb, null, true);
        history.push({ role: 'assistant', content: fb, fallback: true });
      } else if (data.response) {
        addBubble('assistant', data.response, data.context);
        history.push({ role: 'assistant', content: data.response, context: data.context });
        if (data.context?.sections_used) addFollowUps(data.context.sections_used);
      } else {
        addBubble('assistant', 'Something went wrong. Please try again.');
      }
    } catch (e) {
      typing.remove();
      const fb = await localFallback(msg);
      addBubble('assistant', fb, null, true);
      history.push({ role: 'assistant', content: fb, fallback: true });
    }

    // Save session
    try { sessionStorage.setItem('ple_chat_history', JSON.stringify(history.slice(-20))); } catch(e) {}

    sending = false;
    sendBtn.disabled = false;
    scrollBottom();
    inputEl.focus();
  }

  async function localFallback(msg) {
    try {
      const kb = await (await fetch(KB_URL)).json();
      const q = msg.toLowerCase();
      const parts = [];

      if (q.match(/what is|intro|explain.*ple|post.?labor/))
        parts.push(`**Post-Labor Economics (L/0)** is ${kb.framework.core_thesis}\n\n${kb.framework.philosophy}`);
      if (q.match(/prosper|pyramid.*prosper|income|ubi/)) {
        const pp = kb.framework.pyramid_of_prosperity;
        parts.push(`**${pp.description}**\n\n` + pp.layers.map(l => `- **${l.name}**: ${l.description}`).join('\n'));
      }
      if (q.match(/power|pyramid.*power|democra/)) {
        const pp = kb.framework.pyramid_of_power;
        parts.push(`**${pp.description}**\n\n` + pp.layers.map(l => `- **${l.name}**: ${l.description}`).join('\n'));
      }
      if (q.match(/attractor|technofeud|trajectory/)) {
        const a = kb.framework.attractor_states;
        if (a) parts.push(`**${a.description}**\n\n` + a.states.map(s => `- **${s.name}**: ${s.description}`).join('\n\n'));
      }
      if (q.match(/four.*offer|strength|dexterity|cognit|empathy/)) {
        const f = kb.framework.four_human_offerings;
        if (f) parts.push(`**${f.description}**\n\n` + f.offerings.map(o => `- **${o.name}**: ${o.description}`).join('\n'));
      }
      if (q.match(/property|intervention|16|dividend/)) {
        const p = kb.framework.property_interventions;
        if (p) parts.push(`**${p.description}**\n\n` + p.interventions.slice(0,6).map(i => `${i.id}. **${i.name}**: ${i.description}`).join('\n'));
      }

      if (parts.length === 0) {
        return 'I can answer questions about **Post-Labor Economics** — try asking about the Pyramid of Prosperity, attractor states, the 16 property interventions, or the Four Human Offerings.';
      }
      return parts.join('\n\n---\n\n');
    } catch(e) {
      return 'Having trouble loading the knowledge base. [Open the full chat](/chat) for a better experience.';
    }
  }

  // Expose API
  window._pleChat = { toggle, send, ask };
})();
