// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════

const MQTT_BROKER = "localhost";
const MQTT_PORT = 9001;
const MQTT_TOPIC = "esp32/data";

const API_URL = "http://localhost:3000/api";  // Node.js/Express server
const POLL_INTERVAL = 5000;                     // HTTP poll every 5 seconds
const CHART_UPDATE_INTERVAL = 20000;            // Chart refresh 

// Thresholds for cold storage
const TEMP_MAX_LIMIT = 20;       // °C - Critical high
const TEMP_MIN_LIMIT = 0;     // °C - Critical low
const HUMIDITY_MAX_LIMIT = 90;  // % - Too humid

// ═══════════════════════════════════════════════════════════
// STATE VARIABLES
// ═══════════════════════════════════════════════════════════

let mqttClient = null;
let chart = null;
let milkChart = null;
let vegChart = null;
let protocolMode = "both"; // "mqtt", "http", "both"

let stats = {
  mqttCount: 0,
  httpCount: 0,
  alertCount: 0,
  dataPoints: 0
};

let latestData = {
  milk: { temperature: null, humidity: null },
  vegetables: { temperature: null, humidity: null },
  source: null,
  timestamp: null
};

// ═══════════════════════════════════════════════════════════
// DOM ELEMENTS
// ═══════════════════════════════════════════════════════════

const mqttStatusEl = document.getElementById("mqtt-status-text");
const httpStatusEl = document.getElementById("http-status-text");
const activeProtocolEl = document.getElementById("active-protocol");

// Milk sensor elements
const milkTempEl = document.getElementById("milk-temp");
const milkHumidityEl = document.getElementById("milk-humidity");
const milkSourceEl = document.getElementById("milk-source");
const milkUpdateEl = document.getElementById("milk-update");
const maxMilkTempEl = document.getElementById("max-milk-temp");
const minMilkTempEl = document.getElementById("min-milk-temp");
const milkAlertEl = document.getElementById("milk-alert");

// Vegetables sensor elements
const vegTempEl = document.getElementById("veg-temp");
const vegHumidityEl = document.getElementById("veg-humidity");
const vegSourceEl = document.getElementById("veg-source");
const vegUpdateEl = document.getElementById("veg-update");
const maxVegTempEl = document.getElementById("max-veg-temp");
const minVegTempEl = document.getElementById("min-veg-temp");
const vegAlertEl = document.getElementById("veg-alert");

const dataCountEl = document.getElementById("data-count");
const mqttCountEl = document.getElementById("mqtt-count");
const httpPostCountEl = document.getElementById("http-post-count");
const alertCountEl = document.getElementById("alert-count");

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
    loadDualCharts();
    chartInterval = setInterval(loadDualCharts, CHART_UPDATE_INTERVAL);
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
    // Process both milk and vegetables sensor data
    if (data.milk && data.vegetables) {
      processDualSensorData(data.milk, data.vegetables, "mqtt", now);
    }
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

    // Parse dual sensor data from HTTP
    let milkData = { temperature: unit.temperature, humidity: unit.humidity };
    let vegData = { temperature: unit.temperature, humidity: unit.humidity };
    
    // Try to parse if they're nested
    if (unit.milk && unit.vegetables) {
      milkData = unit.milk;
      vegData = unit.vegetables;
    }

    processDualSensorData(milkData, vegData, "http", now);

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

function processDualSensorData(milkData, vegData, source, timestamp) {
  const milkTemp = parseFloat(milkData.temperature);
  const milkHum = parseFloat(milkData.humidity);
  const vegTemp = parseFloat(vegData.temperature);
  const vegHum = parseFloat(vegData.humidity);

  if (isNaN(milkTemp) || isNaN(milkHum) || isNaN(vegTemp) || isNaN(vegHum)) return;

  latestData = {
    milk: { temperature: milkTemp, humidity: milkHum },
    vegetables: { temperature: vegTemp, humidity: vegHum },
    source,
    timestamp: timestamp.toLocaleTimeString()
  };

  // Update Milk sensor display
  milkTempEl.textContent = milkTemp.toFixed(1);
  milkHumidityEl.textContent = milkHum.toFixed(1);
  milkTempEl.style.color = getTemperatureColor(milkTemp);
  milkHumidityEl.style.color = getHumidityColor(milkHum);
  milkSourceEl.textContent = `Source: ${source.toUpperCase()}`;
  milkUpdateEl.textContent = `Last: ${timestamp.toLocaleTimeString()}`;

  // Update Vegetables sensor display
  vegTempEl.textContent = vegTemp.toFixed(1);
  vegHumidityEl.textContent = vegHum.toFixed(1);
  vegTempEl.style.color = getTemperatureColor(vegTemp);
  vegHumidityEl.style.color = getHumidityColor(vegHum);
  vegSourceEl.textContent = `Source: ${source.toUpperCase()}`;
  vegUpdateEl.textContent = `Last: ${timestamp.toLocaleTimeString()}`;

  // Check alerts for both sensors
  checkDualSensorAlerts(milkTemp, milkHum, vegTemp, vegHum);

  addLog(`📊 ${source.toUpperCase()}: Milk ${milkTemp.toFixed(1)}°C/${milkHum.toFixed(1)}% | Veg ${vegTemp.toFixed(1)}°C/${vegHum.toFixed(1)}%`);

  stats.dataPoints++;
  dataCountEl.textContent = stats.dataPoints;
}

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

function checkDualSensorAlerts(milkTemp, milkHum, vegTemp, vegHum) {
  let alerted = false;

  // Check milk sensor alerts
  if (milkTemp > TEMP_MAX_LIMIT) {
    showAlert(milkAlertEl, `🚨 CRITICAL: Milk Temp ${milkTemp.toFixed(1)}°C > ${TEMP_MAX_LIMIT}°C!`, "danger");
    alerted = true;
  } else if (milkTemp < TEMP_MIN_LIMIT) {
    showAlert(milkAlertEl, `🧊 WARNING: Milk Temp ${milkTemp.toFixed(1)}°C below ${TEMP_MIN_LIMIT}°C`, "warning");
    alerted = true;
  } else {
    hideAlert(milkAlertEl);
  }

  if (milkHum > HUMIDITY_MAX_LIMIT) {
    showAlert(milkAlertEl, `💧 HIGH HUMIDITY (Milk): ${milkHum.toFixed(1)}% > ${HUMIDITY_MAX_LIMIT}%`, "warning");
    alerted = true;
  }

  // Check vegetables sensor alerts
  if (vegTemp > TEMP_MAX_LIMIT) {
    showAlert(vegAlertEl, `🚨 CRITICAL: Veg Temp ${vegTemp.toFixed(1)}°C > ${TEMP_MAX_LIMIT}°C!`, "danger");
    alerted = true;
  } else if (vegTemp < TEMP_MIN_LIMIT) {
    showAlert(vegAlertEl, `🧊 WARNING: Veg Temp ${vegTemp.toFixed(1)}°C below ${TEMP_MIN_LIMIT}°C`, "warning");
    alerted = true;
  } else {
    hideAlert(vegAlertEl);
  }

  if (vegHum > HUMIDITY_MAX_LIMIT) {
    showAlert(vegAlertEl, `💧 HIGH HUMIDITY (Veg): ${vegHum.toFixed(1)}% > ${HUMIDITY_MAX_LIMIT}%`, "warning");
    alerted = true;
  }

  if (alerted) {
    stats.alertCount++;
    alertCountEl.textContent = stats.alertCount;
  }
}

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
  // Support both raw per-reading rows (unit_type + temperature/humidity)
  // and aggregated rows (unit_type + avg_temp/avg_humidity)
  const milkTemps = [];
  const vegTemps = [];
  const milkHums = [];
  const vegHums = [];

  data.forEach(d => {
    const unit = (d.unit_type || '').toString().toLowerCase();
    const temp = parseFloat(d.temperature || d.avg_temp || d.milk_temperature || d.milk_temp);
    const hum = parseFloat(d.humidity || d.avg_humidity || d.milk_humidity || d.humidity);
    if (!isNaN(temp)) {
      if (unit === 'milk') milkTemps.push(temp);
      else if (unit === 'vegetables') vegTemps.push(temp);
      else {
        // unknown unit: try to push to both if reasonable
        milkTemps.push(temp);
        vegTemps.push(temp);
      }
    }
    if (!isNaN(hum)) {
      if (unit === 'milk') milkHums.push(hum);
      else if (unit === 'vegetables') vegHums.push(hum);
      else {
        milkHums.push(hum);
        vegHums.push(hum);
      }
    }
  });

  console.log("Stats - Milk temps:", milkTemps.length, "| Veg temps:", vegTemps.length);

  if (milkTemps.length > 0) {
    const maxTemp = Math.max(...milkTemps);
    const minTemp = Math.min(...milkTemps);
    maxMilkTempEl.textContent = maxTemp.toFixed(1);
    minMilkTempEl.textContent = minTemp.toFixed(1);
  }

  if (vegTemps.length > 0) {
    const maxTemp = Math.max(...vegTemps);
    const minTemp = Math.min(...vegTemps);
    maxVegTempEl.textContent = maxTemp.toFixed(1);
    minVegTempEl.textContent = minTemp.toFixed(1);
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

  // Utility: create vertical gradient for fills
  function createGradient(ctx, colorStart, colorEnd) {
    const g = ctx.createLinearGradient(0, 0, 0, chartCanvas.height || 300);
    g.addColorStop(0, colorStart);
    g.addColorStop(1, colorEnd);
    return g;
  }

  // Dynamic y bounds with padding
  const tempVals = temps.filter(v => !isNaN(v));
  const humVals = hums.filter(v => !isNaN(v));
  const allTempMin = tempVals.length ? Math.min(...tempVals) : 0;
  const allTempMax = tempVals.length ? Math.max(...tempVals) : 30;
  const tempPad = Math.max(1, (allTempMax - allTempMin) * 0.12);

  const allHumMin = humVals.length ? Math.min(...humVals) : 0;
  const allHumMax = humVals.length ? Math.max(...humVals) : 100;
  const humPad = Math.max(2, (allHumMax - allHumMin) * 0.12);

  const dataPointCount = labels.length;
  const showPoints = dataPointCount <= 60;

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Temperature (°C)",
          data: temps,
          borderColor: "#ff7a45",
          backgroundColor: createGradient(ctx, 'rgba(255,122,69,0.22)', 'rgba(255,122,69,0.02)'),
          tension: 0.28,
          borderWidth: 2.5,
          pointRadius: showPoints ? 3 : 0,
          pointHoverRadius: 6,
          pointBackgroundColor: '#ff7a45',
          fill: true,
          spanGaps: true
        },
        {
          label: "Humidity (%)",
          data: hums,
          borderColor: "#2bb3ff",
          backgroundColor: createGradient(ctx, 'rgba(43,179,255,0.18)', 'rgba(43,179,255,0.02)'),
          tension: 0.28,
          borderWidth: 2.5,
          fill: true,
          yAxisID: "y1",
          pointRadius: showPoints ? 3 : 0,
          pointHoverRadius: 6,
          pointBackgroundColor: '#2bb3ff',
          spanGaps: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      animation: { duration: 350 },
      plugins: {
        legend: { display: true, position: 'top', labels: { usePointStyle: true } },
        title: { display: true, text: `Historical Data · ${dataPointCount} readings`, padding: 10 },
        tooltip: {
          enabled: true,
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(0,0,0,0.85)',
          titleColor: '#fff',
          bodyColor: '#fff',
          padding: 10,
          callbacks: {
            title: (items) => items && items.length ? items[0].label : '',
            label: (ctx) => `${ctx.dataset.label}: ${ctx.formattedValue}`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: 12,
            callback: function(value, index) {
              // Prefer concise 1-based numeric labels when original labels are generic (Reading # or #N)
              const label = this.getLabelForValue(value);
              if (!label) return '';
              const m = label.toString().match(/^#?(?:Reading\s*)?(\d+)$/i);
              if (m) return String(Number(m[1]));
              return label;
            }
          },
          grid: { color: 'rgba(0,0,0,0.04)' }
        },
        y: {
          position: 'left',
          title: { display: true, text: 'Temperature (°C)' },
          suggestedMin: allTempMin - tempPad,
          suggestedMax: allTempMax + tempPad,
          grid: { color: 'rgba(0,0,0,0.04)' }
        },
        y1: {
          position: 'right',
          title: { display: true, text: 'Humidity (%)' },
          suggestedMin: Math.max(0, allHumMin - humPad),
          suggestedMax: Math.min(100, allHumMax + humPad),
          grid: { drawOnChartArea: false }
        }
      }
    }
  });

  addLog(`📈 Chart plotted: ${dataPointCount} readings`, "info");
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

// New: load and render separate charts for milk and vegetables
async function loadDualCharts() {
  if (protocolMode === "mqtt") {
    console.log("Chart disabled: MQTT-only mode");
    return;
  }

  try {
    // Prefer aggregated hourly data
    let response = await fetch(`${API_URL}/history-all`);
    let data = await response.json();

    if (!response.ok || !data || data.length === 0) {
      // Fallback to raw data
      response = await fetch(`${API_URL}/raw-data`);
      data = await response.json();
    }

    // Separate datasets
    const milkLabels = [];
    const milkTemps = [];
    const milkHums = [];

    const vegLabels = [];
    const vegTemps = [];
    const vegHums = [];

    data.forEach((d, idx) => {
      const unit = (d.unit_type || d.unit_type || '').toString().toLowerCase();
      const timeLabel = d.time ? (new Date(d.time)).toLocaleString() : `#${idx+1}`;

      if (unit === 'milk') {
        milkLabels.push(timeLabel);
        milkTemps.push(parseFloat(d.temperature || d.avg_temp || d.milk_temperature || d.milk_temp) || 0);
        milkHums.push(parseFloat(d.humidity || d.avg_humidity || d.milk_humidity) || 0);
      } else if (unit === 'vegetables') {
        vegLabels.push(timeLabel);
        vegTemps.push(parseFloat(d.temperature || d.avg_temp || d.veg_temperature || d.veg_temp) || 0);
        vegHums.push(parseFloat(d.humidity || d.avg_humidity || d.veg_humidity) || 0);
      }
    });

    renderMiniChart('milkChart', milkLabels, milkTemps, milkHums, 'Milk Temperature / Humidity');
    renderMiniChart('vegChart', vegLabels, vegTemps, vegHums, 'Vegetables Temperature / Humidity');

    addLog(`📈 Dual charts updated: Milk ${milkTemps.length} points, Veg ${vegTemps.length} points`, 'info');
  } catch (err) {
    console.error('❌ Dual charts load error:', err);
    addLog(`❌ Chart error: ${err.message}`, 'error');
  }
}

function renderMiniChart(canvasId, labels, temps, hums, title) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  let chartRef = canvasId === 'milkChart' ? milkChart : vegChart;
  if (chartRef) chartRef.destroy();

  const ctx = canvas.getContext('2d');
  // create subtle gradients
  function createGradientLocal(c, a, b) {
    const g = c.createLinearGradient(0, 0, 0, canvas.height || 220);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    return g;
  }

  const tempVals = temps.filter(v => !isNaN(v));
  const humVals = hums.filter(v => !isNaN(v));
  const tMin = tempVals.length ? Math.min(...tempVals) : 0;
  const tMax = tempVals.length ? Math.max(...tempVals) : 30;
  const hMin = humVals.length ? Math.min(...humVals) : 0;
  const hMax = humVals.length ? Math.max(...humVals) : 100;

  chartRef = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Temperature (°C)',
          data: temps,
          borderColor: '#ff8a65',
          backgroundColor: createGradientLocal(ctx, 'rgba(255,138,101,0.18)', 'rgba(255,138,101,0.02)'),
          tension: 0.32,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 6,
          fill: true,
          yAxisID: 'y'
        },
        {
          label: 'Humidity (%)',
          data: hums,
          borderColor: '#66c2ff',
          backgroundColor: createGradientLocal(ctx, 'rgba(102,194,255,0.12)', 'rgba(102,194,255,0.02)'),
          tension: 0.32,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 6,
          fill: true,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: title, padding: 6 },
        legend: { display: true, position: 'top' },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: { title: (items) => items && items.length ? items[0].label : '', label: (ctx) => `${ctx.dataset.label}: ${ctx.formattedValue}` }
        }
      },
      elements: { point: { hoverRadius: 6 } },
      scales: {
        x: { 
          ticks: { 
            maxRotation: 30,
            autoSkip: true,
            callback: function(value, index) {
              const label = this.getLabelForValue(value);
              if (!label) return '';
              const m = label.toString().match(/^#?(?:Reading\s*)?(\d+)$/i);
              if (m) return String(Number(m[1]));
              return label;
            }
          },
          grid: { color: 'rgba(0,0,0,0.03)' } 
        },
        y: { position: 'left', suggestedMin: tMin - 1, suggestedMax: tMax + 1, title: { display: true, text: '°C' } },
        y1: { position: 'right', suggestedMin: Math.max(0, hMin - 5), suggestedMax: Math.min(100, hMax + 5), title: { display: true, text: '%' }, grid: { drawOnChartArea: false } }
      }
    }
  });

  if (canvasId === 'milkChart') milkChart = chartRef;
  else vegChart = chartRef;
}