# WarGame - Multiplayer Strategy Game

A real-time multiplayer strategy game built with React, TypeScript, Node.js, and Socket.io.

## Features

- 🎮 Real-time multiplayer gameplay
- 🏰 Castle defense mechanics
- ⚔️ Multiple unit types (soldiers, archers, wizards, dragons)
- 🎯 Defense structures (traps, turrets, mines)
- 🎰 High-risk gambling feature (1/10,000 chance to win instantly!)
- 🎲 Integrated Plinko mini-game
- 🎪 Roulette wheel for unit upgrades
- 🏆 Castle upgrade system
- ⚡ Optimized performance with reduced lag

## How to Play

1. Join a game room
2. Choose your army color
3. Deploy units on your side
4. Build defenses to protect your castle
5. Attack your opponent's castle to win!
6. Use the gamble feature for a chance at instant victory (1000 coins, 1/10,000 odds)

## Local Development

```bash
# Install dependencies
npm install

# Start development server (both client and server)
npm run dev

# Or start with host mode for network access
npm run dev:host
```

## Deployment Options

### Option 1: Render (Free, Recommended)

1. Push your code to GitHub
2. Go to [render.com](https://render.com)
3. Connect your GitHub repository
4. Deploy as a Web Service
5. Set build command: `npm install && npm run build`
6. Set start command: `npm start`

### Option 2: Heroku

1. Install Heroku CLI
2. Login: `heroku login`
3. Create app: `heroku create your-game-name`
4. Deploy: `git push heroku main`

### Option 3: Railway

1. Go to [railway.app](https://railway.app)
2. Connect GitHub repository
3. Deploy with default settings

### Option 4: Vercel + Railway

- Deploy frontend to Vercel
- Deploy backend to Railway
- Update VITE_SERVER_URL environment variable

## Environment Variables

For production deployment, set:
- `PORT` - Server port (automatically set by most platforms)
- `NODE_ENV=production`

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Bootstrap
- **Backend**: Node.js, Express, Socket.io
- **Real-time**: WebSocket connections
- **Deployment**: Compatible with Render, Heroku, Railway, Vercel

## Game Mechanics

- **Resources**: Earn coins over time to buy units and upgrades
- **Units**: Different types with unique abilities and costs
- **Defense**: Build traps, turrets, and mines strategically
- **Gambling**: Risk 1000 coins for a 1/10,000 chance to win instantly
- **Castle Upgrades**: Improve your base's defenses and appearance

## Performance Optimizations

- Reduced server tick rate from 100ms to 150ms
- Limited client rendering to 30 FPS
- Simplified canvas animations
- Optimized network updates

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  plugins: {
    // Add the react-x and react-dom plugins
    'react-x': reactX,
    'react-dom': reactDom,
  },
  rules: {
    // other rules...
    // Enable its recommended typescript rules
    ...reactX.configs['recommended-typescript'].rules,
    ...reactDom.configs.recommended.rules,
  },
})
```
