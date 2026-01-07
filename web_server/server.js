const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json());

// MySQL Configuration - CHANGE THESE
const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'MuhammadBoota09299',  // CHANGE THIS
  database: 'cold_storage'
});

// Receive data from ESP32
app.post('/api/sensor-data', async (req, res) => {
  const { device_id = 'ESP32', temperature, humidity, timestamp } = req.body;
  
  await db.query(
    'INSERT INTO sensor_readings (device_id, temperature, humidity, esp32_timestamp) VALUES (?, ?, ?, ?)',
    [device_id, temperature, humidity, timestamp]
  );
  
  console.log(`📡 ${temperature}°C, ${humidity}%`);
  res.json({ status: 'success' });
});

// Get latest reading (JavaScript polls this)
app.get('/api/current-status', async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM sensor_readings ORDER BY server_timestamp DESC LIMIT 1'
  );
  res.json(rows);
});

// Get history for chart (supports variable hours - default 720 = 30 days)
app.get('/api/history/:hours', async (req, res) => {
  try {
    const hours = parseInt(req.params.hours) || 24;
    
    const [rows] = await db.query(
      `SELECT 
        DATE_FORMAT(server_timestamp, '%Y-%m-%d %H:%i:00') as time,
        AVG(temperature) as avg_temp,
        MAX(temperature) as max_temp,
        MIN(temperature) as min_temp,
        AVG(humidity) as avg_humidity,
        MAX(humidity) as max_humidity,
        MIN(humidity) as min_humidity
      FROM sensor_readings
      WHERE server_timestamp >= DATE_SUB(NOW(), INTERVAL ? HOUR)
      GROUP BY DATE_FORMAT(server_timestamp, '%Y-%m-%d %H:%i')
      ORDER BY time ASC`,
      [hours]
    );
    
    console.log(`📊 History API: Returned ${rows.length} hourly readings for last ${hours} hours`);
    res.json(rows);
  } catch (error) {
    console.error('❌ History endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get ALL raw sensor readings (no aggregation - all individual data points)
app.get('/api/raw-data', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT 
        device_id,
        temperature,
        humidity,
        server_timestamp as time
      FROM sensor_readings
      ORDER BY server_timestamp ASC`
    );
    
    console.log(`📊 Raw Data API: Returned ${rows.length} total raw sensor readings`);
    res.json(rows);
  } catch (error) {
    console.error('❌ Raw data endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get ALL historical data (hourly aggregated - no time limit)
app.get('/api/history-all', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT 
        DATE_FORMAT(server_timestamp, '%Y-%m-%d %H:%i:00') as time,
        AVG(temperature) as avg_temp,
        MAX(temperature) as max_temp,
        MIN(temperature) as min_temp,
        AVG(humidity) as avg_humidity,
        MAX(humidity) as max_humidity,
        MIN(humidity) as min_humidity
      FROM sensor_readings
      GROUP BY DATE_FORMAT(server_timestamp, '%Y-%m-%d %H:%i')
      ORDER BY time ASC`
    );
    
    console.log(`📊 All History API: Returned ${rows.length} total hourly readings`);
    res.json(rows);
  } catch (error) {
    console.error('❌ All history endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000');
});