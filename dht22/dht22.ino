#include <WiFi.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <DHT.h>

// Configuration
const char* ssid = "boota";
const char* password = "Boota09299";
const char* mqtt_server = "192.168.43.127";
const int mqtt_port = 1883;
const char* mqtt_topic_milk = "esp32/milk";
const char* mqtt_topic_vegetables = "esp32/vegetables";
const char* http_server = "http://192.168.43.127:3000/api/sensor-data";

// DHT22 Sensors on GPIO15 and GPIO4
#define DHTPIN_MILK 15      // Milk sensor
#define DHTPIN_VEGETABLES 4  // Vegetables sensor
#define DHTTYPE DHT22
DHT dht_milk(DHTPIN_MILK, DHTTYPE);
DHT dht_vegetables(DHTPIN_VEGETABLES, DHTTYPE);

// Clients
WiFiClient espClient;
PubSubClient client(espClient);
HTTPClient http;

// Timing
unsigned long lastMQTTPublish = 0;
unsigned long lastHTTPPublish = 0;
const unsigned long MQTT_INTERVAL = 1000;   // publish MQTT every 1 second
const unsigned long HTTP_INTERVAL = 5000;   // publish HTTP every 5 seconds

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
  
  dht_milk.begin();
  dht_vegetables.begin();
  client.setServer(mqtt_server, mqtt_port);
}

void publishMQTT(float temp_milk, float humidity_milk, float temp_vegetables, float humidity_vegetables) {
  unsigned long ts = millis();
  char payload[256];
  snprintf(payload, sizeof(payload),
           "{\"device_id\":\"ESP32\",\"timestamp\":%lu,\"milk\":{\"temperature\":%.2f,\"humidity\":%.2f},\"vegetables\":{\"temperature\":%.2f,\"humidity\":%.2f}}",
           ts, temp_milk, humidity_milk, temp_vegetables, humidity_vegetables);

  client.publish("esp32/data", payload);
  Serial.printf("MQTT: %s\n", payload);
}

void publishHTTP(float temp_milk, float humidity_milk, float temp_vegetables, float humidity_vegetables) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("HTTP: WiFi not connected");
    return;
  }

  http.begin(http_server);
  http.addHeader("Content-Type", "application/json");

  unsigned long ts = millis();
  char payload[512];
  snprintf(payload, sizeof(payload),
           "{\"device_id\":\"ESP32\",\"timestamp\":%lu,\"milk\":{\"temperature\":%.2f,\"humidity\":%.2f},\"vegetables\":{\"temperature\":%.2f,\"humidity\":%.2f}}",
           ts, temp_milk, humidity_milk, temp_vegetables, humidity_vegetables);

  int httpCode = http.POST(payload);
  if (httpCode > 0) {
    Serial.printf("HTTP: %d - %s\n", httpCode, payload);
  } else {
    Serial.printf("HTTP: Failed to POST\n");
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

  // Read sensor data from both sensors
  float temp_milk = dht_milk.readTemperature();
  float humidity_milk = dht_milk.readHumidity();
  float temp_vegetables = dht_vegetables.readTemperature();
  float humidity_vegetables = dht_vegetables.readHumidity();
  
  if (isnan(temp_milk) || isnan(humidity_milk) || isnan(temp_vegetables) || isnan(humidity_vegetables)) {
    Serial.println("Sensor read failed");
    client.loop();
    delay(100);
    return;
  }
  
  // Publish to MQTT (every MQTT_INTERVAL)
  if (millis() - lastMQTTPublish > MQTT_INTERVAL) {
    lastMQTTPublish = millis();
    publishMQTT(temp_milk, humidity_milk, temp_vegetables, humidity_vegetables);
  }

  // Publish to HTTP (every HTTP_INTERVAL)
  if (millis() - lastHTTPPublish > HTTP_INTERVAL) {
    lastHTTPPublish = millis();
    publishHTTP(temp_milk, humidity_milk, temp_vegetables, humidity_vegetables);
  }
  
  client.loop();
}