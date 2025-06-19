@echo off
echo 🚀 Deploying WarGame...
echo.

echo 📦 Building project...
call npm run build

if %errorlevel% neq 0 (
    echo ❌ Build failed!
    pause
    exit /b 1
)

echo ✅ Build complete!
echo.
echo 🌐 Ready for deployment!
echo.
echo 📋 Deployment Instructions:
echo 1. Push your code to GitHub
echo 2. Go to render.com and connect your repository
echo 3. Set build command: npm install ^&^& npm run build
echo 4. Set start command: npm start
echo 5. Deploy and share your game URL!
echo.
echo 🎮 Your game will be available at: https://your-app-name.onrender.com
echo.
pause
