@echo off
set PATH=%PATH%;C:\Program Files\nodejs
cd /d "c:\Users\jugal\Downloads\telegram-license-bot"
node bot.js >> bot-runtime.log 2>&1
