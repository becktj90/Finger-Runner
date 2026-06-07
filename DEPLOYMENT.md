# GitHub Pages Deployment Guide

## Quick Start - 3 Steps to Live

### Step 1: Enable GitHub Pages
1. Go to https://github.com/becktj90/Finger-Runner/settings
2. Scroll to **"Pages"** section on the left sidebar
3. Under "Source", select:
   - **Deploy from a branch**
   - Branch: `v1-production`
   - Folder: `/ (root)`
4. Click **"Save"**

### Step 2: Wait for Deployment
- GitHub will build and deploy automatically
- You'll see a green checkmark when complete (usually 1-2 minutes)
- Watch the "Deployments" tab for status

### Step 3: Access Your Game
Your game will be live at:
```
https://becktj90.github.io/Finger-Runner/
```

---

## What Gets Deployed

The v1-production branch contains:
- ✅ `index.html` - Main game file
- ✅ `style.css` - All styling
- ✅ `game.js` - Complete game engine
- ✅ `README.md` - Documentation

**No build step required.** GitHub Pages serves files directly.

---

## Troubleshooting

### Page not loading?
- Check that you selected the correct branch (`v1-production`)
- Wait 2-3 minutes for deployment to complete
- Clear your browser cache (Ctrl+Shift+Del)

### Game won't start?
- Open DevTools (F12) and check Console for errors
- Verify all three files (index.html, style.css, game.js) are in the root

### Game is slow?
- GitHub Pages is fast; lag is likely device-related
- On mobile, close other apps
- Try reducing browser tabs

### Custom domain?
- Go to Settings > Pages > Custom Domain
- Add your domain (e.g., `runner.yourdomain.com`)
- Follow DNS setup instructions

---

## Performance Notes

**Server Response:** ~100ms (GitHub CDN)  
**Load Time:** 2-3 seconds on 4G  
**Game FPS:** 60 FPS (after load)  
**File Size:** ~24KB (includes all assets)

---

## Next Steps

Once deployed, you can:
1. ✅ Share the link
2. ✅ Add to social media
3. ✅ Deploy v1.1 updates to the same branch
4. ✅ Monitor usage via GitHub Analytics

---

## Need Help?

- GitHub Pages docs: https://docs.github.com/en/pages
- Game source: https://github.com/becktj90/Finger-Runner
- Report issues: Create a GitHub issue in the repo

---

**Status:** Ready for deployment ✅  
**Branch:** v1-production  
**Version:** 1.0.0  
**Last Updated:** 2026-06-07
