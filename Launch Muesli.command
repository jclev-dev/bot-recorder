#!/bin/bash

# Launch Muesli - Electron Meeting Recorder App
# Double-click this file to start the application

cd "$(dirname "$0")"

# Kill any existing instances to avoid port conflicts
pkill -f "node.*server.js" 2>/dev/null
lsof -ti:13373 | xargs kill -9 2>/dev/null
sleep 1

# Start the app
npm start
