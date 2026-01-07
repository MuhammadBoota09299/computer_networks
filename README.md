## Install and Setup Mosquitto MQTT Broker on Windows

### 1. Add Mosquitto to Windows PATH
(To run mosquitto from any terminal)

1. Right-click "This PC" → Properties → Advanced system settings → Environment Variables
2. Under "System variables", select Path → Edit → New
3. Add: `C:\Program Files\mosquitto`
4. Click OK to save

### 2. Configure Mosquitto
1. Open File Explorer and navigate to: `C:\Program Files\mosquitto`
2. Create or edit the file: `mosquitto.conf`
3. If the file doesn't exist, create it as a plain text file
4. Add the following configuration:

```conf
# Default MQTT listener (for ESP32 TCP connections)
listener 1883

# WebSockets listener (for browser/JavaScript Paho client)
listener 9001
protocol websockets

# Allow anonymous access (for testing only - disable in production)
allow_anonymous true

# Enable verbose logging
log_dest stdout
log_type all
```

5. Save the file

### 3. Start the MQTT Broker

1. Open a Command Prompt or PowerShell
2. Run the following command:

```cmd
mosquitto -c "C:\Program Files\mosquitto\mosquitto.conf" -v
```

3. You should see output similar to:

```
Opening ipv4 listen socket on port 1883.
Opening websockets listen socket on port 9001.
mosquitto version x.x.x running
```

4. Keep this terminal open while the broker is running

