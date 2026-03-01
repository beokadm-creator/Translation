# Deployment Guide

Complete deployment guide for the Translation platform to Firebase production environment.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Pre-Deployment Checklist](#pre-deployment-checklist)
- [Environment Setup](#environment-setup)
- [Building for Production](#building-for-production)
- [Deploying to Firebase](#deploying-to-firebase)
- [Post-Deployment Verification](#post-deployment-verification)
- [Rollback Procedures](#rollback-procedures)
- [Monitoring & Logging](#monitoring--logging)
- [CI/CD Configuration](#cicd-configuration)

## Prerequisites

### Required Tools

- Firebase CLI (latest)
- Node.js 18+ LTS
- Git

### Firebase Project Access

Ensure you have access to the Firebase project:

```bash
firebase projects:list
firebase use translation-comm
```

## Pre-Deployment Checklist

### 1. Code Quality

- [ ] All TypeScript errors resolved
- [ ] Linting passes (`npm run lint` in client & functions)
- [ ] No console errors in browser
- [ ] All environment variables configured

### 2. Testing

- [ ] Test audio capture flow
- [ ] Verify STT (Whisper) integration
- [ ] Verify text refinement (Gemini)
- [ ] Verify translation (Google Translate)
- [ ] Test admin authentication
- [ ] Test audience view real-time updates
- [ ] Test overlay view language switching

### 3. Configuration

- [ ] Firebase project selected (`firebase use`)
- [ ] Firebase Security Rules updated
- [ ] Firestore indexes configured
- [ ] Environment variables set in production
- [ ] API keys valid and within quotas

### 4. Build

- [ ] Client production build successful
- [ ] Functions build successful
- [ ] No build errors or warnings

## Environment Setup

### Production Environment Variables

For production, use Firebase Functions config or Secret Manager.

#### Option 1: Firebase Functions Config

```bash
# Set OpenAI API key
firebase functions:config:set openai.key="sk-..."

# Set Gemini API key
firebase functions:config:set gemini.key="AI..."

# Set Google TTS API key
firebase functions:config:set google_tts.key="AI..."

# Set Google API key
firebase functions:config:set google.key="AI..."

# Verify config
firebase functions:config:get
```

Access in code:

```typescript
// functions/src/stt.ts
const openai = new OpenAI({
  apiKey: functions.config().openai.key
});
```

#### Option 2: Secret Manager (Recommended)

```bash
# Set secrets
echo "sk-..." | firebase functions:secrets:set OPENAI_API_KEY
echo "AI..." | firebase functions:secrets:set GEMINI_API_KEY
echo "AI..." | firebase functions:secrets:set GOOGLE_TTS_API_KEY
echo "AI..." | firebase functions:secrets:set GOOGLE_API_KEY

# List secrets
firebase functions:secrets:access OPENAI_API_KEY
```

Access in code:

```typescript
// functions/src/stt.ts
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
```

**⚠️ Important**: Never commit API keys to Git. Use environment variables or secrets.

### Firebase Security Rules

Ensure production rules are configured:

```bash
# Deploy rules
firebase deploy --only firestore:rules,database:rules,storage:rules
```

Review rules before deployment:
- `firestore.rules` - Firestore access rules
- `database.rules.json` - Realtime DB access rules
- `storage.rules` - Firebase Storage rules

## Building for Production

### 1. Client Build

```bash
cd client
npm run build
```

**Output**: `client/dist/` (optimized, minified bundle)

**Verify build**:
```bash
ls -la client/dist
# Should contain: index.html, assets/, vite.svg
```

**Preview production build locally**:
```bash
cd client
npm run preview
```

### 2. Functions Build

```bash
cd functions
npm run build
```

**Output**: `functions/lib/` (compiled JavaScript)

**Verify build**:
```bash
ls -la functions/lib
# Should contain: index.js, stt.js, translate.js, etc.
```

### 3. Build All (One Command)

From `functions/` directory:

```bash
cd functions
npm run build:all
```

This builds both client and functions.

## Deploying to Firebase

### Full Deployment (Recommended)

Deploy all Firebase resources:

```bash
# From project root
firebase deploy
```

This deploys:
- **Hosting** (`client/dist`)
- **Functions** (`functions/`)
- **Firestore Rules**
- **Database Rules**
- **Storage Rules**
- **Firestore Indexes**

**Deployment time**: ~2-5 minutes

### Partial Deployments

Deploy only specific resources:

```bash
# Deploy hosting only
firebase deploy --only hosting

# Deploy functions only
firebase deploy --only functions

# Deploy specific function
firebase deploy --only functions:processAudio

# Deploy rules only
firebase deploy --only firestore:rules,database:rules

# Deploy indexes
firebase deploy --only firestore:indexes
```

### Deployment Options

#### 1. Standard Deployment

```bash
firebase deploy
```

**Flags**:
- `--only <targets>` - Deploy specific targets
- `--force` - Skip confirmation prompts
- `--debug` - Enable debug logging

#### 2. Production Deployment

```bash
# Deploy to production
firebase use translation-comm
firebase deploy
```

#### 3. Staging Deployment (if configured)

```bash
# Deploy to staging
firebase use translation-staging
firebase deploy
```

## Post-Deployment Verification

### 1. Hosting Verification

Visit the deployed URL:

```
https://translation-comm.web.app
```

**Check**:
- [ ] Page loads successfully
- [ ] All static assets load (CSS, JS, images)
- [ ] No console errors
- [ ] Routing works (refresh on `/admin`, `/p/:projectId`, etc.)

### 2. Functions Verification

Check Cloud Functions deployment:

```bash
# List deployed functions
firebase functions:list

# View function logs
firebase functions:log --only processAudio
```

**Test Functions**:

1. **processAudio** (STT):
```bash
# Test via curl
curl -X POST \
  "https://processAudio-{region}-translation-comm.cloudfunctions.net/processAudio?projectId=test&sourceLabel=admin" \
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @audio.webm
```

2. **archiveSession**:
```bash
curl -X POST \
  "https://archiveSession-{region}-translation-comm.cloudfunctions.net/archiveSession" \
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"projectId": "test", "sessionId": "session123"}'
```

### 3. Realtime Database Verification

1. Visit Firebase Console: https://console.firebase.google.com/project/translation-comm/database
2. Check data structure:
```
projects/
  └── {projectId}/
      └── stream/
```

### 4. Firestore Verification

1. Visit Firebase Console: https://console.firebase.google.com/project/translation-comm/firestore
2. Check collections:
```
projects/{projectId}/settings
```

### 5. Auth Verification

1. Test login at: `https://translation-comm.web.app/login`
2. Verify admin access at: `https://translation-comm.web.app/admin`

## Rollback Procedures

### Hosting Rollback

Firebase Hosting keeps a history of deployments:

```bash
# List deployment history
firebase hosting:rollback --project translation-comm

# Rollback to previous version
firebase hosting:rollback --project translation-comm --version <version-id>
```

### Functions Rollback

Cloud Functions don't have built-in rollback. Deploy previous code:

```bash
# Checkout previous commit
git checkout <previous-commit-hash>

# Rebuild and deploy
cd client && npm run build
cd ../functions && npm run build
firebase deploy --only functions
```

### Database Rules Rollback

```bash
# Deploy previous rules version
firebase deploy --only firestore:rules --rules-file <previous-rules-file>
```

## Monitoring & Logging

### Cloud Functions Logging

View real-time logs:

```bash
# All functions
firebase functions:log

# Specific function
firebase functions:log --only processAudio

# Follow logs (tail)
firebase functions:log --only processAudio --limit 10
```

### Firebase Console Monitoring

Access monitoring dashboards:

1. **Cloud Functions**: https://console.firebase.google.com/project/translation-comm/functions
2. **Realtime Database**: https://console.firebase.google.com/project/translation-comm/database
3. **Firestore**: https://console.firebase.google.com/project/translation-comm/firestore
4. **Crashlytics** (if configured)

### Key Metrics to Monitor

| Metric | Alert Threshold |
|--------|-----------------|
| Function error rate | > 5% |
| Function execution time | > 60 seconds |
| Whisper API latency | > 10 seconds |
| Daily active users | Monitor trends |
| RTDB concurrent connections | Monitor capacity |

### Set Up Alerts

1. Visit Firebase Console → Project Settings → Monitoring
2. Configure alerts for:
   - Function errors
   - Function cold starts
   - API quota usage
   - Database read/write operations

## CI/CD Configuration

### GitHub Actions Example

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Firebase

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: |
          npm install
          cd client && npm install
          cd ../functions && npm install

      - name: Build client
        run: |
          cd client
          npm run build

      - name: Build functions
        run: |
          cd functions
          npm run build

      - name: Deploy to Firebase
        uses: w9jds/firebase-action@master
        with:
          args: deploy --only hosting,functions
        env:
          FIREBASE_TOKEN: ${{ secrets.FIREBASE_TOKEN }}
```

### Required GitHub Secrets

Set these in repository settings:

1. `FIREBASE_TOKEN` - Firebase CI token
   ```bash
   firebase login:ci
   # Copy token and add to GitHub Secrets
   ```

2. `OPENAI_API_KEY` - OpenAI API key
3. `GEMINI_API_KEY` - Gemini API key
4. `GOOGLE_TTS_API_KEY` - Google TTS API key
5. `GOOGLE_API_KEY` - Google Cloud API key

### GitLab CI Example

Create `.gitlab-ci.yml`:

```yaml
stages:
  - build
  - deploy

build:
  stage: build
  image: node:18
  script:
    - npm install
    - cd client && npm install && npm run build
    - cd ../functions && npm install && npm run build
  artifacts:
    paths:
      - client/dist
      - functions/lib

deploy:
  stage: deploy
  image: node:18
  script:
    - npm install -g firebase-tools
    - firebase deploy --only hosting,functions --token "$FIREBASE_TOKEN"
  only:
    - main
```

## Performance Optimization

### Hosting Performance

1. **Enable CDN caching** - Automatic with Firebase Hosting
2. **Minimize bundle size** - Already done by Vite
3. **Use image optimization** - Serve optimized images
4. **Enable compression** - Automatic with Firebase Hosting

### Functions Performance

1. **Reduce cold starts** - Keep functions warm
2. **Optimize memory** - Configure memory allocation
3. **Use regional deployment** - Deploy closer to users
4. **Enable min instances** - Reserve function instances

```javascript
// functions/src/stt.ts
export const processAudio = onRequest({
  memory: "1GiB",
  minInstances: 1,
  timeoutSeconds: 60,
}, async (req, res) => {
  // Function logic
});
```

### Database Performance

1. **Use indexes** - Create Firestore indexes
2. **Optimize queries** - Limit query results
3. **Use pagination** - Load data in chunks
4. **Cache frequently accessed data** - Use RTDB for hot data

## Security Checklist

### Pre-Deployment Security

- [ ] API keys stored in secrets (not in code)
- [ ] Firebase Security Rules reviewed
- [ ] HTTPS enforced (automatic with Firebase)
- [ ] Authentication required for admin functions
- [ ] Rate limiting configured (if applicable)
- [ ] CORS configured properly
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (use Firestore parameterized queries)
- [ ] XSS prevention (React auto-escapes, but verify)
- [ ] CSRF tokens (if using cookies)

### Post-Deployment Security

1. **Monitor for suspicious activity**:
   - Unusual function invocations
   - Spike in database operations
   - Failed authentication attempts

2. **Regular security audits**:
   - Review Firebase Security Rules
   - Check for exposed API keys
   - Audit user permissions
   - Review third-party dependencies

3. **Keep dependencies updated**:
   ```bash
   npm audit
   npm audit fix
   ```

## Cost Management

### Firebase Pricing Tiers

| Service | Free Tier | Paid Tier |
|---------|-----------|-----------|
| Hosting | 10 GB/month | $0.026/GB |
| Cloud Functions | 125K invocations/month | $0.40/M invocations |
| Realtime DB | 1 GB stored, 10 GB/month downloaded | $5/GB stored |
| Firestore | 50K reads, 20K writes/day | $0.06/100K reads |
| Storage | 5 GB | $0.026/GB |

### Cost Optimization Tips

1. **Minimize RTDB listeners** - Unsubscribe when not needed
2. **Optimize function execution time** - Reduce processing time
3. **Use compression** - Reduce data transfer
4. **Set database rules** - Limit read/write operations
5. **Monitor usage** - Set up budget alerts

### Budget Alerts

Configure in Firebase Console:

1. Project Settings → Billing
2. Set budget alerts for:
   - Daily spending limit
   - Monthly spending limit
   - Per-service limits

## Troubleshooting Deployment

### Error: "Deployment failed"

**Possible causes**:
- Build errors
- Invalid Firebase configuration
- Insufficient permissions

**Solutions**:
```bash
# Check build
cd client && npm run build
cd ../functions && npm run build

# Verify Firebase project
firebase use

# Check permissions
firebase projects:list
```

### Error: "Function execution timeout"

**Solutions**:
- Increase timeout in function configuration
- Optimize function code
- Split long-running tasks

### Error: "Quota exceeded"

**Solutions**:
- Check API quotas (OpenAI, Gemini, Google)
- Upgrade API tier
- Implement rate limiting
- Optimize API usage

### Error: "Security rules denied"

**Solutions**:
- Review and update security rules
- Verify user authentication
- Check data paths in rules
- Test rules in Firebase Console

---

**Related Documentation:**
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [DEVELOPMENT.md](DEVELOPMENT.md) - Development setup
- [API.md](API.md) - API reference
