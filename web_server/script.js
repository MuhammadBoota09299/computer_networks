// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════

const MQTT_BROKER = "localhost";
const MQTT_PORT = 9001;
const MQTT_TOPIC = "esp32/data";

const API_URL = "http://localhost:3000/api";  // Node.js/Express server
const POLL_INTERVAL = 5000;                     // HTTP poll every 5 seconds
const CHART_UPDATE_INTERVAL = 60000;            // Chart refresh every minute

// Thresholds for cold storage
const TEMP_MAX_LIMIT = 20;       // °C - Critical high
const TEMP_MIN_LIMIT = 0;     // °C - Critical low
const HUMIDITY_MAX_LIMIT = 90;  // % - Too humid

// ═══════════════════════════════════════════════════════════
// STATE VARIABLES
// ═══════════════════════════════════════════════════════════

let mqttClient = null;
let chart = null;
let protocolMode = "both"; // "mqtt", "http", "both"

let stats = {
  mqttCount: 0,
  httpCount: 0,
  alertCount: 0,
  dataPoints: 0
};

let latestData = {
  temperature: null,
  humidity: null,
  source: null,
  timestamp: null
};

// ═══════════════════════════════════════════════════════════
// DOM ELEMENTS
// ═══════════════════════════════════════════════════════════

const mqttStatusEl = document.getElementById("mqtt-status-text");
const httpStatusEl = document.getElementById("http-status-text");
const activeProtocolEl = document.getElementById("active-protocol");

const temperatureEl = document.getElementById("temperature");
const humidityEl = document.getElementById("humidity");
const tempSourceEl = document.getElementById("temp-source");
const humiditySourceEl = document.getElementById("humidity-source");
const tempUpdateEl = document.getElementById("temp-update");
const humidityUpdateEl = document.getElementById("humidity-update");

const maxTempEl = document.getElementById("max-temp");
const minTempEl = document.getElementById("min-temp");
const maxHumidityEl = document.getElementById("max-humidity");
const minHumidityEl = document.getElementById("min-humidity");

const dataCountEl = document.getElementById("data-count");
const mqttCountEl = document.getElementById("mqtt-count");
const httpPostCountEl = document.getElementById("http-post-count");
const alertCountEl = document.getElementById("alert-count");

const tempAlertEl = document.getElementById("temp-alert");
const humidityAlertEl = document.getElementById("humidity-alert");
const messageLog = document.getElementById("message-log");

// Protocol buttons
const btnMqtt = document.getElementById("toggle-mqtt");
const btnHttp = document.getElementById("toggle-http");
const btnBoth = document.getElementById("toggle-both");

// ═══════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  addLog("🚀 Cold Storage Dashboard Loaded");

  // Setup protocol buttons
  btnMqtt.onclick = () => setProtocol("mqtt");
  btnHttp.onclick = () => setProtocol("http");
  btnBoth.onclick = () => setProtocol("both");

  // Initialize based on default protocol mode
  if (protocolMode === "mqtt" || protocolMode === "both") {
    initMQTT();
  }
  if (protocolMode === "http" || protocolMode === "both") {
    startHTTPPolling();
    loadChartData();
    chartInterval = setInterval(loadChartData, CHART_UPDATE_INTERVAL);
  }
});

// ═══════════════════════════════════════════════════════════
// PROTOCOL SWITCHING
// ═══════════════════════════════════════════════════════════

let chartInterval = null;  // Track chart interval for cleanup

function setProtocol(mode) {
  protocolMode = mode;

  btnMqtt.classList.toggle("active", mode === "mqtt" || mode === "both");
  btnHttp.classList.toggle("active", mode === "http" || mode === "both");
  btnBoth.classList.toggle("active", mode === "both");

  activeProtocolEl.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);

  addLog(`🔄 Protocol switched to: <strong>${mode.toUpperCase()}</strong>`, "info");

  // Handle MQTT initialization/disconnection
  if (mode === "mqtt" || mode === "both") {
    if (!mqttClient || !mqttClient.isConnected()) {
      addLog("🔄 Initializing MQTT...");
      initMQTT();
    }
  } else {
    // Disconnect MQTT if not needed
    if (mqttClient && mqttClient.isConnected()) {
      mqttClient.disconnect();
      updateMQTTStatus(false, "MQTT Disabled");
      addLog("🔌 MQTT Disconnected");
    }
  }

  // Handle Chart/HTTP initialization
  if (mode === "http" || mode === "both") {
    if (!chartInterval) {
      addLog("📊 Starting HTTP polling and chart updates...");
      loadCurrentHTTPData();
      loadChartData();
      chartInterval = setInterval(loadChartData, CHART_UPDATE_INTERVAL);
    }
  } else {
    // Stop chart updates if not needed
    if (chartInterval) {
      clearInterval(chartInterval);
      chartInterval = null;
      if (chart) {
        chart.destroy();
        chart = null;
      }
      addLog("📉 Chart updates stopped");
    }
  }
}

// ═══════════════════════════════════════════════════════════
// MQTT REAL-TIME
// ═══════════════════════════════════════════════════════════

function initMQTT() {
  addLog("🔄 Connecting to MQTT broker...");

  mqttClient = new Paho.MQTT.Client(MQTT_BROKER, MQTT_PORT, "/mqtt", "dashboard_" + Math.random().toString(16).substr(2, 8));

  mqttClient.onConnectionLost = onMQTTConnectionLost;
  mqttClient.onMessageArrived = onMQTTMessage;

  mqttClient.connect({
    onSuccess: onMQTTConnect,
    onFailure: onMQTTFailure,
    timeout: 10
  });
}

function onMQTTConnect() {
  updateMQTTStatus(true, "MQTT Connected");
  addLog("✅ MQTT Connected - Real-time streaming active");
  mqttClient.subscribe(MQTT_TOPIC);
}

function onMQTTFailure(err) {
  updateMQTTStatus(false, "MQTT Failed");
  addLog(`❌ MQTT Connection failed: ${err.errorMessage}`, "error");
}

function onMQTTConnectionLost(response) {
  if (response.errorCode !== 0) {
    updateMQTTStatus(false, "MQTT Lost");
    addLog(`MQTT Connection lost: ${response.errorMessage}`, "error");
  }
}

function onMQTTMessage(message) {
  if (protocolMode === "http") return;  // Ignore MQTT messages if only HTTP is active

  const payload = message.payloadString.trim();
  const now = new Date();

  try {
    const data = JSON.parse(payload);
    processSensorData(data, "mqtt", now);
    stats.mqttCount++;
    mqttCountEl.textContent = stats.mqttCount;
  } catch (e) {
    addLog("Invalid MQTT JSON received", "error");
  }
}

function updateMQTTStatus(connected, text) {
  mqttStatusEl.textContent = connected ? "✓ " + text : "✗ " + text;
  document.getElementById("mqtt-status").className = connected ? "status connected" : "status disconnected";
}

// ═══════════════════════════════════════════════════════════
// HTTP PERIODIC POLLING
// ═══════════════════════════════════════════════════════════

let httpPollInterval = null;

function startHTTPPolling() {
  addLog("📡 Starting HTTP polling every 5 seconds");
  loadCurrentHTTPData();
  httpPollInterval = setInterval(() => {
    if (protocolMode === "http" || protocolMode === "both") {
      loadCurrentHTTPData();
    }
  }, POLL_INTERVAL);
}

async function loadCurrentHTTPData() {
  if (protocolMode === "mqtt") return;  // Ignore HTTP if only MQTT is active

  try {
    const response = await fetch(`${API_URL}/current-status`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (data.length === 0) {
      addLog("No HTTP data yet", "info");
      return;
    }

    const unit = data[0];
    const now = new Date();

    processSensorData({
      temperature: unit.temperature,
      humidity: unit.humidity
    }, "http", now);

    stats.httpCount++;
    httpPostCountEl.textContent = stats.httpCount;
    updateHTTPStatus(true, "HTTP Synced");

  } catch (err) {
    updateHTTPStatus(false, "HTTP Error");
    addLog(`HTTP fetch failed: ${err.message}`, "error");
  }
}

function updateHTTPStatus(connected, text) {
  httpStatusEl.textContent = connected ? "✓ " + text : "✗ " + text;
  document.getElementById("http-status").className = connected ? "status connected" : "status disconnected";
}

// ═══════════════════════════════════════════════════════════
// DATA PROCESSING
// ═══════════════════════════════════════════════════════════

function processSensorData(data, source, timestamp) {
  const temp = parseFloat(data.temperature);
  const hum = parseFloat(data.humidity);

  if (isNaN(temp) || isNaN(hum)) return;

  latestData = { temperature: temp, humidity: hum, source, timestamp: timestamp.toLocaleTimeString() };

  temperatureEl.textContent = temp.toFixed(1);
  humidityEl.textContent = hum.toFixed(1);

  temperatureEl.style.color = getTemperatureColor(temp);
  humidityEl.style.color = getHumidityColor(hum);

  tempSourceEl.textContent = `Source: ${source.toUpperCase()}`;
  humiditySourceEl.textContent = `Source: ${source.toUpperCase()}`;

  tempUpdateEl.textContent = `Last: ${timestamp.toLocaleTimeString()}`;
  humidityUpdateEl.textContent = `Last: ${timestamp.toLocaleTimeString()}`;

  checkAlerts(temp, hum);

  addLog(`📊 ${source.toUpperCase()}: ${temp.toFixed(1)}°C, ${hum.toFixed(1)}%`);

  stats.dataPoints++;
  dataCountEl.textContent = stats.dataPoints;
}

// ═══════════════════════════════════════════════════════════
// ALERT SYSTEM
// ═══════════════════════════════════════════════════════════

function checkAlerts(temp, hum) {
  let alerted = false;

  if (temp > TEMP_MAX_LIMIT) {
    showAlert(tempAlertEl, `🚨 CRITICAL: Temp ${temp.toFixed(1)}°C > ${TEMP_MAX_LIMIT}°C!`, "danger");
    alerted = true;
  } else if (temp < TEMP_MIN_LIMIT) {
    showAlert(tempAlertEl, `🧊 WARNING: Temp ${temp.toFixed(1)}°C below ${TEMP_MIN_LIMIT}°C`, "warning");
    alerted = true;
  } else {
    hideAlert(tempAlertEl);
  }

  if (hum > HUMIDITY_MAX_LIMIT) {
    showAlert(humidityAlertEl, `💧 HIGH HUMIDITY: ${hum.toFixed(1)}% > ${HUMIDITY_MAX_LIMIT}%`, "warning");
    alerted = true;
  } else {
    hideAlert(humidityAlertEl);
  }

  if (alerted) {
    stats.alertCount++;
    alertCountEl.textContent = stats.alertCount;
  }
}

function showAlert(el, message, type) {
  el.innerHTML = message;
  el.className = `alert-box ${type}`;
  el.style.display = "block";
}

function hideAlert(el) {
  el.style.display = "none";
}

// ═══════════════════════════════════════════════════════════
// CHART & HISTORY
// ═══════════════════════════════════════════════════════════

async function loadChartData() {
  if (protocolMode === "mqtt") {
    console.log("Chart disabled: MQTT-only mode");
    return;
  }

  try {
    console.log("📊 Fetching ALL raw sensor data from database (no aggregation)...");
    
    // Fetch raw data - all individual readings
    let response = await fetch(`${API_URL}/raw-data`);
    let data = await response.json();
    
    console.log("Raw data fetch - Data points:", data.length);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (!data || data.length === 0) {
      console.warn("⚠️ No raw data found. Trying hourly aggregated data...");
      response = await fetch(`${API_URL}/history-all`);
      data = await response.json();
      console.log("Fallback to hourly data - Data points:", data.length);
    }

    console.log("✅ Chart data received:", data.length, "readings");
    
    if (!data || data.length === 0) {
      addLog("⏳ Waiting for data in database... (ESP32 must send at least one reading)", "info");
      console.warn("⚠️ No data found in database. Ensure ESP32 is sending data to the server.");
      return;
    }

    // Process raw data into chart format
    const labels = data.map((d, idx) => {
      if (d.time) {
        const date = new Date(d.time);
        return date.toLocaleTimeString().slice(0, 5);  // HH:MM format
      }
      return `Reading ${idx + 1}`;
    });
    
    const temps = data.map(d => parseFloat(d.temperature) || parseFloat(d.avg_temp) || 0);
    const hums = data.map(d => parseFloat(d.humidity) || parseFloat(d.avg_humidity) || 0);

    console.log("   Data points:", labels.length);
    console.log("   Temperature range:", Math.min(...temps).toFixed(1), "°C →", Math.max(...temps).toFixed(1), "°C");
    console.log("   Humidity range:", Math.min(...hums).toFixed(1), "% →", Math.max(...hums).toFixed(1), "%");

    updateStatsFromHistory(data);
    renderChart(labels, temps, hums);
    addLog(`📈 Historical chart loaded: ${data.length} readings from database`, "info");

  } catch (err) {
    console.error("❌ Chart load error:", err);
    addLog(`❌ Chart error: ${err.message}`, "error");
  }
}

function updateStatsFromHistory(data) {
  // Handle both raw data and aggregated data
  const temps = data.map(d => {
    // Try raw data first, then aggregated
    const temp = parseFloat(d.temperature) || parseFloat(d.max_temp) || parseFloat(d.min_temp);
    return !isNaN(temp) ? temp : null;
  }).filter(v => v !== null);
  
  const hums = data.map(d => {
    // Try raw data first, then aggregated
    const hum = parseFloat(d.humidity) || parseFloat(d.max_humidity) || parseFloat(d.min_humidity);
    return !isNaN(hum) ? hum : null;
  }).filter(v => v !== null);

  console.log("Stats - Temperature values:", temps.length, "| Humidity values:", hums.length);

  if (temps.length > 0) {
    const maxTemp = Math.max(...temps);
    const minTemp = Math.min(...temps);
    maxTempEl.textContent = maxTemp.toFixed(1);
    minTempEl.textContent = minTemp.toFixed(1);
    console.log(`  ✓ Max Temp: ${maxTemp.toFixed(1)}°C | Min Temp: ${minTemp.toFixed(1)}°C`);
  }
  
  if (hums.length > 0) {
    const maxHum = Math.max(...hums);
    const minHum = Math.min(...hums);
    maxHumidityEl.textContent = maxHum.toFixed(1);
    minHumidityEl.textContent = minHum.toFixed(1);
    console.log(`  ✓ Max Humidity: ${maxHum.toFixed(1)}% | Min Humidity: ${minHum.toFixed(1)}%`);
  }
}

function renderChart(labels, temps, hums) {
  const chartCanvas = document.getElementById("dataChart");
  
  if (!chartCanvas) {
    console.error("Chart canvas not found!");
    addLog("❌ Chart canvas element missing in HTML", "error");
    return;
  }

  const ctx = chartCanvas.getContext("2d");

  if (chart) chart.destroy();

  console.log("Creating chart with Chart.js...");
  console.log(`  Data points: ${labels.length}`);
  
  // Optimize for large datasets
  const dataPointCount = labels.length;
  const showPoints = dataPointCount <= 50;
  const decimationEnabled = dataPointCount > 100;
  
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Temperature (°C)",
          data: temps,
          borderColor: "#ff6b6b",
          backgroundColor: "rgba(255,107,107,0.1)",
          tension: 0.15,
          borderWidth: 2,
          fill: true,
          pointRadius: showPoints ? 3 : 0,
          pointHoverRadius: 5,
          pointBackgroundColor: "#ff6b6b",
          spanGaps: false
        },
        {
          label: "Humidity (%)",
          data: hums,
          borderColor: "#4ecdc4",
          backgroundColor: "rgba(78,205,196,0.1)",
          tension: 0.15,
          borderWidth: 2,
          fill: true,
          yAxisID: "y1",
          pointRadius: showPoints ? 3 : 0,
          pointHoverRadius: 5,
          pointBackgroundColor: "#4ecdc4",
          spanGaps: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      animation: {
        duration: 500
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 15
          }
        },
        title: {
          display: true,
          text: `Historical Data - ${dataPointCount} readings`,
          padding: 15
        },
        tooltip: {
          enabled: true,
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: '#ddd',
          borderWidth: 1,
          padding: 12,
          displayColors: true
        }
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: Math.min(12, Math.ceil(dataPointCount / 10)),
            maxRotation: 45,
            minRotation: 0
          },
          grid: {
            display: true,
            color: 'rgba(0, 0, 0, 0.05)'
          }
        },
        y: { 
          position: "left",
          title: {
            display: true,
            text: 'Temperature (°C)',
            font: { size: 12, weight: 'bold' }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          }
        },
        y1: { 
          position: "right",
          title: {
            display: true,
            text: 'Humidity (%)',
            font: { size: 12, weight: 'bold' }
          },
          grid: { 
            drawOnChartArea: false 
          }
        }
      }
    }
  });
  
  console.log("✅ Chart rendered successfully with", dataPointCount, "data points");
  addLog(`📈 Chart plotted: ${dataPointCount} readings (${showPoints ? 'with' : 'without'} point markers)`, "info");
}

// ═══════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════

function addLog(text, type = "info") {
  const entry = document.createElement("div");
  entry.className = `message-entry ${type}`;
  entry.innerHTML = `<span class="time">[${new Date().toLocaleTimeString()}]</span> ${text}`;
  messageLog.prepend(entry);

  if (messageLog.children.length > 50) {
    messageLog.removeChild(messageLog.lastChild);
  }
}

// ═══════════════════════════════════════════════════════════
// COLOR HELPERS
// ═══════════════════════════════════════════════════════════

function getTemperatureColor(temp) {
  if (temp < 0) return "#00ffff";
  if (temp < 10) return "#0099ff";
  if (temp < 15) return "#28a745";
  if (temp < 19) return "#ffc107";
  return "#dc3545";
}

function getHumidityColor(hum) {
  if (hum < 30) return "#995500";
  if (hum < 60) return "#28a745";
  if (hum < 80) return "#ffc107";
  return "#dc3545";
}