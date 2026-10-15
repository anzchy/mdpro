@echo off
set APPDATA=C:\Users\jack\mdpro-audit\fakeappdata
start "" /wait cmd /c "set APPDATA> C:\Users\jack\mdpro-audit\out\childenv.txt"
