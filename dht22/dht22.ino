#include <WiFi.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <DHT.h>

// Configuration
const char* ssid = "boota";
const char* password = "Boota09299";
const char* mqtt_server = "192.168.43.127";
const int mqtt_port = 1883;
const char* mqtt_topic = "esp32/data";
const char* http_server = "http://192.168.43.127:3000/api/sensor-data";

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
unsigned long lastHTTPPublish = 0;
const unsigned long MQTT_INTERVAL = 100;
const unsigned long HTTP_INTERVAL = 5000;

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("Initializing...");
  
  WiFi.begin(ssid, password);
  delay(1000);
  Serial.println("connecting...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println(WiFi.status() == WL_CONNECTED ? "\nWiFi Connected" : "\nWiFi Failed");
  
  dht.begin();
  client.setServer(mqtt_server, mqtt_port);
}

void publishMQTT(float temp, float humidity) {
  char payload[128];
  snprintf(payload, sizeof(payload), 
           "{\"temperature\":%.2f,\"humidity\":%.2f}",
           temp, humidity);
  
  client.publish(mqtt_topic, payload);
  Serial.printf("MQTT: T=%.2f C, H=%.2f %%\n", temp, humidity);
}

void publishHTTP(float temp, float humidity) {
  http.begin(http_server);
  http.addHeader("Content-Type", "application/json");
  
  char payload[256];
  snprintf(payload, sizeof(payload),
           "{\"device_id\":\"ESP32\",\"temperature\":\%.2f,\"humidity\":\%.2f}",
           temp, humidity);
  
  int httpCode = http.POST(payload);
  if (httpCode > 0) {
    Serial.printf("HTTP: Response %d\n", httpCode);
  } else {
    Serial.println("HTTP: Failed");
  }
  http.end();
}

void loop() {
  // Reconnect WiFi if needed
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected. Reconnecting...");
    WiFi.begin(ssid, password);
    delay(5000);
    return;
  }

  // Reconnect MQTT if needed
  if (!client.connected()) {
    String clientId = "ESP32_" + String(random(0xffff), HEX);
    client.connect(clientId.c_str());
    delay(1000);
    return;
  }

  // Read sensor data
  float temp = dht.readTemperature();
  float humidity = dht.readHumidity();
  
  if (isnan(temp) || isnan(humidity)) {
    Serial.println("Sensor read failed");
    client.loop();
    delay(100);
    return;
  }
  
  // Publish to MQTT (every 10 seconds)
  if (millis() - lastMQTTPublish > MQTT_INTERVAL) {
    lastMQTTPublish = millis();
    publishMQTT(temp, humidity);
  }
  
  // Publish to HTTP (every 60 seconds)
  if (millis() - lastHTTPPublish > HTTP_INTERVAL) {
    lastHTTPPublish = millis();
    publishHTTP(temp, humidity);
  }
  
  client.loop();
}