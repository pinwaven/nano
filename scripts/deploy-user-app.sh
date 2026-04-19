#!/bin/bash
set -e

# 1. Build the User App
echo "Building User App..."
cd src/web/user-app
npx vite build

# 2. Deploy the user-app FC function
echo "Deploying user-app function..."
cd ../../..
s user-app deploy -y

# 3. Update domain routing
echo "Updating domain routes..."
s nano-domain deploy -y

echo "Done! User App is live at https://nano.fros.cc/app/"
