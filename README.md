# Cold Storage Monitoring System

A comprehensive IoT monitoring system using ESP32 microcontroller to track temperature and humidity in cold storage environments. The system uses MQTT for real-time data transmission and a web-based dashboard to display sensor readings.

## Prerequisites

Before starting, ensure you have the following installed and configured:

- **Windows 10 or later** - Operating system
- **Administrator access** - Required for installing software
- **Arduino IDE** - For programming the ESP32 (download from [arduino.cc](https://www.arduino.cc/en/software))
- **MySQL Server** - Database server (installed and running)
- **MySQL Workbench** - For database management (download from [mysql.com](https://www.mysql.com/products/workbench/))
- **Visual Studio Code** - Code editor (optional but recommended)
- **Node.js v24.12.0** - Included in the repo, or download from [nodejs.org](https://nodejs.org/)
- **Python 3.x** - Optional, only needed if using Python's built-in server instead of Live Server
- **Git** - For cloning the repository (download from [git-scm.com](https://git-scm.com/))

## Table of Contents

1. [Getting Started](#getting-started)
2. [Setting Up ESP32 Controller](#setting-up-esp32-controller)
3. [Install and Setup Mosquitto MQTT Broker](#install-and-setup-mosquitto-mqtt-broker-on-windows)
4. [Setting Up the Database](#setting-up-the-database)
5. [Installing Node.js](#installing-nodejs)
6. [Hosting the Website Locally](#hosting-the-website-locally)
7. [Project Architecture](#project-architecture)
8. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Clone the Repository

Open Command Prompt or PowerShell and run:

```cmd
git clone https://github.com/MuhammadBoota09299/computer_networks.git
cd computer_networks
```

## Setting Up ESP32 Controller

### Prerequisites
- Arduino IDE installed with ESP32 board support
- ESP32 board connected to your computer via USB
- Your laptop and ESP32 must be connected to the same WiFi network

### Steps

1. **Find your computer's IP address**:
   - Open Command Prompt or PowerShell
   - Run:
   
   ```cmd
   ipconfig
   ```
   
   - Note the **IPv4 Address** (typically looks like `192.168.x.x`)

2. **Configure the Arduino sketch**:
   - Open `ght22/ght22.ino` in Arduino IDE
   - Find the following lines and update them:
   
   ```cpp
   const char* mqtt_server = "YOUR_IP_ADDRESS";  // Replace with your IPv4 address from step 1
   const char* ssid = "YOUR_WIFI_NAME";          // Replace with your WiFi network name
   const char* password = "YOUR_WIFI_PASSWORD";  // Replace with your WiFi password
   ```

3. **Compile and upload**:
   - Select your ESP32 board: Tools → Board → ESP32 Dev Module (or your specific board)
   - Select the correct COM port: Tools → Port
   - Click Upload (or press Ctrl+U)
   - Wait for the upload to complete

4. **Verify connection**:
   - Open the Serial Monitor (Tools → Serial Monitor) to view debug messages
   - You should see connection confirmation messages

## Install and Setup Mosquitto MQTT Broker on Windows

### 1. Install Mosquitto

1. Download the Mosquitto installer from the repo or from [mosquitto.org](https://mosquitto.org/download/)
2. Run the installer as administrator: `mosquitto-2.0.x-install-windows-x64.exe`
3. Follow the installation wizard and complete the installation
4. Mosquitto will be installed to `C:\Program Files\mosquitto`

### 2. Add Mosquitto to Windows PATH

To run mosquitto from any Command Prompt or PowerShell:

1. Right-click "This PC" → Properties → Advanced system settings → Environment Variables
2. Under "System variables", select Path → Edit → New
3. Add: `C:\Program Files\mosquitto`
4. Click OK and restart Command Prompt/PowerShell

### 3. Configure Mosquitto
1. Open File Explorer and navigate to: `C:\Program Files\mosquitto`
2. Create or edit the file `mosquitto.conf` using a text editor (Notepad, VS Code, etc.)
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

### 4. Start the MQTT Broker

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

> **Note**: Keep the Mosquitto broker running in a separate terminal window before starting your ESP32 or web client applications.

## Setting Up the Database

1. Open MySQL Workbench and connect to your MySQL server
2. Run the following SQL commands:

```sql
CREATE DATABASE cold_storage;
USE cold_storage;

CREATE TABLE sensor_readings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(100),
  temperature DECIMAL(5,2),
  humidity DECIMAL(5,2),
  esp32_timestamp BIGINT,
  server_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (server_timestamp DESC)
);
```

This will create your database and table for storing sensor readings.

## Installing Node.js

1. Run as administrator: `node-v24.12.0-x64.msi` (the installer file in the repo)
2. Follow the installation wizard and complete the installation
3. After installation, open Command Prompt or PowerShell
4. Navigate to the `web_server` directory:

```cmd
cd web_server
```

5. Install dependencies:

```cmd
npm install
```

6. Configure your database credentials in `server.js`:
   - Open `server.js` in a text editor
   - Find the database connection configuration
   - Update the MySQL username and password to match your database credentials

7. Start the server:

```cmd
node server.js
```

After that, your server will start running and you can access it via `http://localhost:3000` (or the configured port).

## Hosting the Website Locally

1. Install the "Live Server" extension in VS Code
2. Open the `index.html` file in VS Code
3. Right-click on `index.html` → Select "Open with Live Server"
4. The website will automatically open in your default browser at `http://127.0.0.1:5500`

### Alternative: Using Python's Built-in Server

If you prefer not to use Live Server extension:

1. Open Command Prompt or PowerShell in the `web_server` directory
2. Run:

```cmd
python -m http.server 8000
```

3. Access the website at `http://localhost:8000`

## Project Architecture

This project consists of three main components:

1. **MQTT Broker (Mosquitto)** - Central message broker
2. **ESP32 Microcontroller** - Sends sensor data via MQTT and HTTP
3. **Web Server & UI** - Displays real-time sensor data from MQTT and historical data from the database 

Data Flow:
- ESP32 → Sends sensor readings (temperature, humidity) to Mosquitto MQTT and HTTP endpoints
- Web Server → Subscribes to MQTT topics and receives HTTP POST requests, then stores data in MySQL database
- Web UI → Fetches and displays sensor data from the database in real-time

## Troubleshooting

### Mosquitto Broker Issues

**Problem**: "mosquitto is not recognized as an internal or external command"
- **Solution**: Ensure Mosquitto is added to Windows PATH correctly. Restart Command Prompt/PowerShell after adding to PATH.

**Problem**: "Port 1883 or 9001 is already in use"
- **Solution**: Change the port numbers in `mosquitto.conf` or stop other services using these ports.

### Database Connection Issues

**Problem**: "Cannot connect to MySQL server"
- **Solution**: Verify MySQL is running. Check username and password in your connection settings.

### Node.js Server Issues

**Problem**: "npm install fails" or "node_modules not found"
- **Solution**: Ensure Node.js is properly installed. Delete `node_modules` folder and run `npm install` again.

**Problem**: "Port 3000 is already in use"
- **Solution**: Change the port in `server.js` or stop the application using port 3000.

### Website Display Issues

**Problem**: "Website won't load or displays errors"
- **Solution**: Ensure the web server is running and accessible at the correct URL. Check browser console for error messages.

## Project Files

```
computer_networks/
├── README.md (this file)
├── ght22/
│   └── ght22.ino (ESP32 Arduino sketch)
└── web_server/
    ├── server.js (Node.js backend server)
    ├── package.json (Node.js dependencies)
    ├── index.html (Main web page)
    ├── styles.css (Website styling)
    └── script.js (Frontend JavaScript)
```

## Notes

- **Security**: The Mosquitto configuration allows anonymous access for testing. For production environments, implement proper authentication.
- **Data Retention**: Sensor data is stored in MySQL database. Implement a data cleanup policy based on your requirements.
- **Network**: Ensure ESP32 and host computer are on the same network for MQTT communication.
- **Performance**: For optimal performance, adjust the MQTT publish frequency based on your data collection needs.

