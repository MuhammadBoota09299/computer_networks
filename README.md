Add Mosquitto to Windows PATH (to run mosquitto from any terminal):
Right-click "This PC" → Properties → Advanced system settings → Environment Variables
Under "System variables", select Path → Edit → New
Add: C:\Program Files\mosquitto
Click OK to save

Configure Mosquitto:
Open the file:
C:\Program Files\mosquitto\mosquitto.conf
(create it if it doesn't exist)
Add the following configuration:


conf# Default MQTT listener (for ESP32 TCP connections)
listener 1883

# WebSockets listener (for browser/JavaScript Paho client)
listener 9001
protocol websockets

# Allow anonymous access (for testing only)
allow_anonymous true

# Enable verbose logging
log_dest stdout
log_type all

Start the MQTT Broker:
Open a new Command Prompt
Run:


cmdmosquitto -c "C:\Program Files\mosquitto\mosquitto.conf" -v
You should see:
textOpening ipv4 listen socket on port 1883.
Opening websockets listen socket on port 9001.
mosquitto version x.x.x running
→ Keep this terminal open
