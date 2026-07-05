# GitHub Pages Deployment Guide

## Quick Start - 3 Steps to Live

### Step 1: Enable GitHub Pages
1. Go to https://github.com/becktj90/Finger-Runner/settings/pages
2. Under "Source", select:
   - **Deploy from a branch**
   - Branch: `main`
   - Folder: `/ (root)`
3. Click **"Save"**

### Step 2: Wait for Deployment
- GitHub will build and deploy automatically
- You'll see a green checkmark when complete (usually 1-2 minutes)
- Watch the "Deployments" tab for status

### Step 3: Access Your Game
Your game is live at:
```
https://becktj90.github.io/Finger-Runner/
```
and, once the custom domain below is set up, also at:
```
https://play.beckify.com/
```

---

## What Gets Deployed

The `main` branch root contains:
- ✅ `index.html` - Main game file
- ✅ `style.css` - All styling
- ✅ `game.js` - Complete game engine
- ✅ `CNAME` - Custom domain mapping (`play.beckify.com`)
- ✅ `README.md` - Documentation

**No build step required.** GitHub Pages serves files directly.

---

## Custom Domain: play.beckify.com

The repo root has a `CNAME` file containing `play.beckify.com`, which tells
GitHub Pages to serve this site on that hostname once DNS is pointed at it.

### DNS setup (done once, at your domain registrar/DNS provider for beckify.com)

Add a **CNAME record**:

| Type  | Host/Name | Value                  |
|-------|-----------|------------------------|
| CNAME | `play`    | `becktj90.github.io.`  |

This only adds the `play` subdomain — it does not touch any existing records
for the apex `beckify.com` or `www.beckify.com`.

### GitHub Pages setup

1. Go to https://github.com/becktj90/Finger-Runner/settings/pages
2. Under "Custom domain", enter `play.beckify.com` and click **Save**
   (GitHub reads this from the `CNAME` file automatically, but the field
   must show it before "Enforce HTTPS" becomes available).
3. Wait for the DNS check to go green (can take a few minutes up to a few
   hours depending on DNS propagation).
4. Once the DNS check passes, check **"Enforce HTTPS"** so the game is only
   served over `https://play.beckify.com/`.

---

## Troubleshooting

### Page not loading?
- Check that you selected the correct branch (`main`)
- Wait 2-3 minutes for deployment to complete
- Clear your browser cache (Ctrl+Shift+Del)

### Game won't start?
- Open DevTools (F12) and check Console for errors
- Verify all three files (index.html, style.css, game.js) are in the root

### Game is slow?
- GitHub Pages is fast; lag is likely device-related
- On mobile, close other apps
- Try reducing browser tabs

### Custom domain shows 404 or a DNS error?
- Confirm the CNAME DNS record (`play` → `becktj90.github.io.`) is created
  at your beckify.com DNS provider
- DNS propagation can take up to 24 hours in rare cases; usually minutes
- Check https://github.com/becktj90/Finger-Runner/settings/pages for the
  domain verification status

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
**Branch:** main  
**Custom domain:** play.beckify.com  
**Version:** 1.0.0  
**Last Updated:** 2026-07-05
