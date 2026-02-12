#!/bin/bash
# PLE Platform - Push to GitHub
# Run this script after extracting the zip

cd "$(dirname "$0")"

# Initialize git if needed
if [ ! -d ".git" ]; then
    git init
    git add -A
    git commit -m "PLE Platform v1.1 - Zero-config deployment"
fi

# Set remote and push
git remote remove origin 2>/dev/null
git remote add origin https://github.com/sillinous/ple-platform.git
git branch -M main
git push -u origin main

echo ""
echo "✅ Pushed to https://github.com/sillinous/ple-platform"
echo ""
echo "Next: Go to Netlify and import this repo to deploy!"
