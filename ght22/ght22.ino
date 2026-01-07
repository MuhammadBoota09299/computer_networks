#include <WiFi.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <DHT.h>

// ═══════════════════════════════════════════════════════════
// CONFIGURATION - Cold Storage Monitoring
// ═══════════════════════════════════════════════════════════

const char* ssid = "boota";
const char* password = "Boota09299";

// MQTT Configuration
const char* mqtt_server = "192.168.43.127";
const int mqtt_port = 1883;
const char* mqtt_topic = "esp32/data";

// HTTP Configuration
const char* http_server = "http://192.168.43.127:3000/api/sensor-data";  // Node.js server endpoint
const unsigned long HTTP_TIMEOUT = 5000;  // 5 second timeout

// DHT22 Sensor on GPIO15
#define DHTPIN 15
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

// Clients
WiFiClient espClient;
PubSubClient client(espClient);
HTTPClient http;

// Timing
unsigned long lastMQTTPublish = 0;
const unsigned long MQTT_INTERVAL = 10000;  // 10 seconds

unsigned long lastHTTPPublish = 0;
const unsigned long HTTP_INTERVAL = 60000;  // 60 seconds (1 minute)

unsigned long lastWiFiRetry = 0;
const unsigned long WIFI_RETRY_INTERVAL = 30000;

unsigned long lastMQTTReconnect = 0;
const unsigned long MQTT_RECONNECT_INTERVAL = 5000;

// Data validation ranges
const float TEMP_MIN = -40.0;
const float TEMP_MAX = 80.0;
const float HUMIDITY_MIN = 0.0;
const float HUMIDITY_MAX = 100.0;

// ═══════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  while (!Serial);
  delay(1000);

  Serial.println();
  Serial.println("========================================");
  Serial.println("   🧊 COLD STORAGE SENSOR - ESP32");
  Serial.println("   MQTT + HTTP Monitoring Active");
  Serial.println("========================================");

  connectWiFi();
  dht.begin();
  client.setServer(mqtt_server, mqtt_port);
}

// ═══════════════════════════════════════════════════════════
// WiFi CONNECTION
// ═══════════════════════════════════════════════════════════

void connectWiFi() {
  WiFi.disconnect(true);
  delay(1000);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi: ");
  Serial.print(ssid);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("✅ WiFi Connected!");
    Serial.print("   IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println();
    Serial.println("❌ WiFi Connection Failed - Will retry...");
  }
}

// ═══════════════════════════════════════════════════════════
// DATA VALIDATION
// ═══════════════════════════════════════════════════════════

bool isValidReading(float temperature, float humidity) {
  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("⚠️ DHT22 returned NaN");
    return false;
  }
  
  if (temperature < TEMP_MIN || temperature > TEMP_MAX) {
    Serial.printf("⚠️ Temperature out of range: %.2f°C\n", temperature);
    return false;
  }
  
  if (humidity < HUMIDITY_MIN || humidity > HUMIDITY_MAX) {
    Serial.printf("⚠️ Humidity out of range: %.2f%%\n", humidity);
    return false;
  }
  
  return true;
}

// ═══════════════════════════════════════════════════════════
// MQTT FUNCTIONS
// ═══════════════════════════════════════════════════════════

void reconnectMQTT() {
  Serial.print("Attempting MQTT connection to ");
  Serial.print(mqtt_server);
  Serial.print("... ");

  String clientId = "ColdStorage_ESP32_" + String(random(0xffff), HEX);

  if (client.connect(clientId.c_str())) {
    Serial.println("✅ Connected!");
  } else {
    Serial.print("❌ Failed, rc=");
    Serial.println(client.state());
  }
}

void publishMQTT(float temperature, float humidity) {
  char payload[128];
  snprintf(payload, sizeof(payload), 
           "{\"temperature\":%.2f,\"humidity\":%.2f,\"timestamp\":%lu}",
           temperature, humidity, millis());

  if (client.publish(mqtt_topic, payload)) {
    Serial.printf("📡 MQTT Published: T=%.2f°C H=%.2f%%\n", temperature, humidity);
  } else {
    Serial.println("❌ MQTT Publish Failed");
  }
}

// ═══════════════════════════════════════════════════════════
// HTTP FUNCTIONS
// ═══════════════════════════════════════════════════════════

void publishHTTP(float temperature, float humidity) {
  http.begin(http_server);
  http.setTimeout(HTTP_TIMEOUT);
  http.addHeader("Content-Type", "application/json");

  char payload[256];
  snprintf(payload, sizeof(payload),
           "{\"device_id\":\"ESP32_ColdStorage\",\"temperature\":%.2f,\"humidity\":%.2f,\"timestamp\":%lu}",
           temperature, humidity, millis());

  Serial.print("🌐 HTTP POST to ");
  Serial.print(http_server);
  Serial.print("... ");

  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    Serial.printf("✅ Response: %d ", httpCode);
    
    if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_CREATED) {
      String response = http.getString();
      Serial.println("(Success)");
      // Optionally print server response
      // Serial.println(response);
    } else {
      Serial.printf("(Unexpected code)\n");
    }
  } else {
    Serial.printf("❌ Failed: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

// ═══════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════

void loop() {
  unsigned long now = millis();

  // WiFi Management
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWiFiRetry > WIFI_RETRY_INTERVAL) {
      lastWiFiRetry = now;
      Serial.println("📶 WiFi disconnected - Reconnecting...");
      connectWiFi();
    }
    delay(1000);
    return;
  }

  // MQTT Management
  if (!client.connected()) {
    if (now - lastMQTTReconnect > MQTT_RECONNECT_INTERVAL) {
      lastMQTTReconnect = now;
      reconnectMQTT();
    }
  }
  
  client.loop();

  // Read Sensor Data
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  // Validate readings
  if (!isValidReading(temperature, humidity)) {
    delay(2000);  // Wait before next read attempt
    return;
  }

  // MQTT Publishing (every 10 seconds)
  if (now - lastMQTTPublish > MQTT_INTERVAL) {
    lastMQTTPublish = now;
    
    if (client.connected()) {
      publishMQTT(temperature, humidity);
    }
  }

  // HTTP Publishing (every 60 seconds)
  if (now - lastHTTPPublish > HTTP_INTERVAL) {
    lastHTTPPublish = now;
    publishHTTP(temperature, humidity);
  }

  delay(10);
}