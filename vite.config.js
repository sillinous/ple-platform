import { defineConfig } from 'vite';
import netlifyPlugin from '@netlify/vite-plugin';

export default defineConfig({
  plugins: [netlifyPlugin()],
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        about: 'about.html',
        login: 'login.html',
        register: 'register.html',
        dashboard: 'dashboard.html',
        proposals: 'proposals.html',
        'proposal-create': 'proposal-create.html',
        'proposal-view': 'proposal-view.html',
        discussions: 'discussions.html',
        architecture: 'architecture.html',
        gato: 'gato.html',
        prime: 'prime.html',
        projects: 'projects.html',
        'project-view': 'project-view.html',
        content: 'content.html',
        'content-view': 'content-view.html',
        'content-editor': 'content-editor.html',
        'discussion-view': 'discussion-view.html',
        profile: 'profile.html',
        '404': '404.html',
        community: 'community.html',
        search: 'search.html',
        tags: 'tags.html',
        glossary: 'glossary.html',
        activity: 'activity.html',
        series: 'series.html',
        'api-docs': 'api-docs.html',
      }
    }
  }
});
