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

// Development helper: verify required tables exist at startup
async function verifySchema() {
  try {
    const needed = ['storage_units', 'milk', 'vegetables'];
    const [rows] = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name IN (?)`,
      ['cold_storage', needed]
    );

    const present = rows.map(r => r.table_name);
    const missing = needed.filter(n => !present.includes(n));
    if (missing.length) {
      console.error('❌ Missing required tables:', missing.join(', '));
      console.error('Run DATABASE_SETUP.sql to create the schema.');
    } else {
      console.log('✅ Database schema verified: all required tables present');
    }
  } catch (err) {
    console.error('❌ Schema verification failed:', err && err.message ? err.message : err);
  }
}

// Receive data from ESP32 (Dual Sensors: Milk & Vegetables)
app.post('/api/sensor-data', async (req, res) => {
  const { device_id = 'ESP32', milk = {}, vegetables = {}, timestamp } = req.body;
  
  const milkTemp = parseFloat(milk.temperature) || null;
  const milkHum = parseFloat(milk.humidity) || null;
  const vegTemp = parseFloat(vegetables.temperature) || null;
  const vegHum = parseFloat(vegetables.humidity) || null;
  
  try {
    // Lookup unit IDs by unit_name
    const [vegUnits] = await db.query('SELECT unit_id FROM storage_units WHERE unit_name = ?', ['Vegetables']);
    const [milkUnits] = await db.query('SELECT unit_id FROM storage_units WHERE unit_name = ?', ['Milk']);

    if (!vegUnits.length || !milkUnits.length) {
      return res.status(404).json({ status: 'error', message: 'Storage units not found' });
    }

    const vegUnitId = vegUnits[0].unit_id;
    const milkUnitId = milkUnits[0].unit_id;

    // Insert milk readings
    if (milkTemp !== null && milkHum !== null) {
      await db.query(
        'INSERT INTO milk (unit_id, temperature, humidity) VALUES (?, ?, ?)',
        [milkUnitId, milkTemp, milkHum]
      );
    }

    // Insert vegetables readings
    if (vegTemp !== null && vegHum !== null) {
      await db.query(
        'INSERT INTO vegetables (unit_id, temperature, humidity) VALUES (?, ?, ?)',
        [vegUnitId, vegTemp, vegHum]
      );
    }
    
    console.log(`📡 Milk: ${milkTemp}°C/${milkHum}%, Vegetables: ${vegTemp}°C/${vegHum}%`);
    res.json({ 
      status: 'success', 
      data_received: { 
        milk: { temp: milkTemp, hum: milkHum }, 
        vegetables: { temp: vegTemp, hum: vegHum } 
      } 
    });
  } catch (error) {
    console.error('❌ Error saving sensor data:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Get latest reading (JavaScript polls this)
app.get('/api/current-status', async (req, res) => {
  try {
    let milkData, vegData;
    try {
      [milkData] = await db.query(`
        SELECT temperature, humidity, server_timestamp
        FROM milk
        ORDER BY server_timestamp DESC
        LIMIT 1
      `);

      [vegData] = await db.query(`
        SELECT temperature, humidity, server_timestamp
        FROM vegetables
        ORDER BY server_timestamp DESC
        LIMIT 1
      `);
    } catch (e) {
      // fallback when server_timestamp column doesn't exist
      console.warn('⚠️ server_timestamp not found, falling back to id ordering');
      [milkData] = await db.query(`
        SELECT temperature, humidity, milk_id as id
        FROM milk
        ORDER BY milk_id DESC
        LIMIT 1
      `);
      [vegData] = await db.query(`
        SELECT temperature, humidity, veg_id as id
        FROM vegetables
        ORDER BY veg_id DESC
        LIMIT 1
      `);
    }

    if (milkData.length === 0 && vegData.length === 0) {
      return res.json([]);
    }

    const data = [{
      device_id: 'ESP32',
      milk: milkData.length ? { temperature: milkData[0].temperature, humidity: milkData[0].humidity } : null,
      vegetables: vegData.length ? { temperature: vegData[0].temperature, humidity: vegData[0].humidity } : null,
      timestamp: (milkData[0] && (milkData[0].server_timestamp || milkData[0].id)) || (vegData[0] && (vegData[0].server_timestamp || vegData[0].id)) || new Date()
    }];

    res.json(data);
  } catch (error) {
    console.error('❌ Current status error:', error && error.message ? error.message : error);
    if (error && error.code) console.error('SQL Error Code:', error.code);
    if (error && error.sqlMessage) console.error('SQL Message:', error.sqlMessage);
    res.status(500).json({ error: error.message || 'Internal Server Error', sqlError: error.sqlMessage || null });
  }
});

// Get history for chart (supports variable hours - default 720 = 30 days)
app.get('/api/history/:hours', async (req, res) => {
  try {
    const hours = parseInt(req.params.hours) || 24;

    let rows, vegRows;
    try {
      [rows] = await db.query(`
        SELECT 
          DATE_FORMAT(m.server_timestamp, '%Y-%m-%d %H:%i:00') as time,
          AVG(m.temperature) as milk_temperature,
          AVG(m.humidity) as milk_humidity
        FROM milk m
        WHERE m.server_timestamp >= DATE_SUB(NOW(), INTERVAL ? HOUR)
        GROUP BY DATE_FORMAT(m.server_timestamp, '%Y-%m-%d %H:%i')
        ORDER BY time ASC
      `, [hours]);

      [vegRows] = await db.query(`
        SELECT 
          DATE_FORMAT(v.server_timestamp, '%Y-%m-%d %H:%i:00') as time,
          AVG(v.temperature) as veg_temperature,
          AVG(v.humidity) as veg_humidity
        FROM vegetables v
        WHERE v.server_timestamp >= DATE_SUB(NOW(), INTERVAL ? HOUR)
        GROUP BY DATE_FORMAT(v.server_timestamp, '%Y-%m-%d %H:%i')
        ORDER BY time ASC
      `, [hours]);
    } catch (e) {
      // Fallback: server_timestamp not available — return recent raw rows instead
      console.warn('⚠️ server_timestamp not found, falling back to raw recent rows for history');
      [rows] = await db.query(`
        SELECT NULL as time, temperature as milk_temperature, humidity as milk_humidity
        FROM milk
        ORDER BY milk_id DESC
        LIMIT 100
      `);
      [vegRows] = await db.query(`
        SELECT NULL as time, temperature as veg_temperature, humidity as veg_humidity
        FROM vegetables
        ORDER BY veg_id DESC
        LIMIT 100
      `);
    }

    // Merge results by time
    const merged = [];
    const milkMap = new Map(rows.map(r => [r.time, r]));
    const vegMap = new Map(vegRows.map(r => [r.time, r]));
    const allTimes = new Set([...milkMap.keys(), ...vegMap.keys()]);

    for (const time of allTimes) {
      const milk = milkMap.get(time) || { milk_temperature: null, milk_humidity: null };
      const veg = vegMap.get(time) || { veg_temperature: null, veg_humidity: null };
      merged.push({ time, ...milk, ...veg });
    }

    console.log(`📊 History API: Returned ${merged.length} hourly readings for last ${hours} hours`);
    res.json(merged.sort((a, b) => new Date(a.time) - new Date(b.time)));
  } catch (error) {
    console.error('❌ History endpoint error:', error && error.message ? error.message : error);
    if (error && error.code) console.error('SQL Error Code:', error.code);
    if (error && error.sqlMessage) console.error('SQL Message:', error.sqlMessage);
    res.status(500).json({ error: error.message || 'Internal Server Error', sqlError: error.sqlMessage || null });
  }
});

// Get ALL raw sensor readings (no aggregation - all individual data points)
app.get('/api/raw-data', async (req, res) => {
  try {
    // Get milk readings
    let milkRows;
    try {
      [milkRows] = await db.query(`
        SELECT 
          'milk' as unit_type,
          s.unit_name,
          m.temperature,
          m.humidity,
          m.server_timestamp as time
        FROM milk m
        JOIN storage_units s ON m.unit_id = s.unit_id
        ORDER BY m.server_timestamp ASC
      `);
    } catch (e) {
      console.warn('⚠️ milk.server_timestamp not found, falling back to id ordering for raw-data');
      [milkRows] = await db.query(`
        SELECT 
          'milk' as unit_type,
          s.unit_name,
          m.temperature,
          m.humidity,
          m.milk_id as time_index
        FROM milk m
        JOIN storage_units s ON m.unit_id = s.unit_id
        ORDER BY m.milk_id ASC
      `);
      // normalize field to `time` null so frontend handles it
      milkRows = milkRows.map(r => ({ unit_type: r.unit_type, unit_name: r.unit_name, temperature: r.temperature, humidity: r.humidity, time: null }));
    }
    
    // Get vegetables readings
    let vegRows;
    try {
      [vegRows] = await db.query(`
        SELECT 
          'vegetables' as unit_type,
          s.unit_name,
          v.temperature,
          v.humidity,
          v.server_timestamp as time
        FROM vegetables v
        JOIN storage_units s ON v.unit_id = s.unit_id
        ORDER BY v.server_timestamp ASC
      `);
    } catch (e) {
      console.warn('⚠️ vegetables.server_timestamp not found, falling back to id ordering for raw-data');
      [vegRows] = await db.query(`
        SELECT 
          'vegetables' as unit_type,
          s.unit_name,
          v.temperature,
          v.humidity,
          v.veg_id as time_index
        FROM vegetables v
        JOIN storage_units s ON v.unit_id = s.unit_id
        ORDER BY v.veg_id ASC
      `);
      vegRows = vegRows.map(r => ({ unit_type: r.unit_type, unit_name: r.unit_name, temperature: r.temperature, humidity: r.humidity, time: null }));
    }
    
    let allRows = [];
    try {
      allRows = [...milkRows, ...vegRows].sort((a, b) => new Date(a.time) - new Date(b.time));
    } catch (e) {
      // if time isn't a valid date (because we fell back to id), just merge and sort by unit_name
      allRows = [...milkRows, ...vegRows];
    }
    
    console.log(`📊 Raw Data API: Returned ${allRows.length} total raw sensor readings`);
    res.json(allRows);
  } catch (error) {
    console.error('❌ Raw data endpoint error:', error && error.message ? error.message : error);
    if (error && error.code) console.error('SQL Error Code:', error.code);
    if (error && error.sqlMessage) console.error('SQL Message:', error.sqlMessage);
    res.status(500).json({ error: error.message || 'Internal Server Error', sqlError: error.sqlMessage || null });
  }
});

// Get ALL historical data (hourly aggregated - no time limit)
app.get('/api/history-all', async (req, res) => {
  try {
    let milkRows, vegRows;
    try {
      [milkRows] = await db.query(`
        SELECT 
          DATE_FORMAT(m.server_timestamp, '%Y-%m-%d %H:%i:00') as time,
          'milk' as unit_type,
          AVG(m.temperature) as avg_temp,
          MAX(m.temperature) as max_temp,
          MIN(m.temperature) as min_temp,
          AVG(m.humidity) as avg_humidity,
          MAX(m.humidity) as max_humidity,
          MIN(m.humidity) as min_humidity
        FROM milk m
        GROUP BY DATE_FORMAT(m.server_timestamp, '%Y-%m-%d %H:%i')
        ORDER BY time ASC
      `);

      [vegRows] = await db.query(`
        SELECT 
          DATE_FORMAT(v.server_timestamp, '%Y-%m-%d %H:%i:00') as time,
          'vegetables' as unit_type,
          AVG(v.temperature) as avg_temp,
          MAX(v.temperature) as max_temp,
          MIN(v.temperature) as min_temp,
          AVG(v.humidity) as avg_humidity,
          MAX(v.humidity) as max_humidity,
          MIN(v.humidity) as min_humidity
        FROM vegetables v
        GROUP BY DATE_FORMAT(v.server_timestamp, '%Y-%m-%d %H:%i')
        ORDER BY time ASC
      `);
    } catch (e) {
      console.warn('⚠️ server_timestamp not found, falling back to recent raw rows for history-all');
      [milkRows] = await db.query(`
        SELECT NULL as time, 'milk' as unit_type, temperature as avg_temp, temperature as max_temp, temperature as min_temp, humidity as avg_humidity, humidity as max_humidity, humidity as min_humidity
        FROM milk
        ORDER BY milk_id ASC
        LIMIT 200
      `);
      [vegRows] = await db.query(`
        SELECT NULL as time, 'vegetables' as unit_type, temperature as avg_temp, temperature as max_temp, temperature as min_temp, humidity as avg_humidity, humidity as max_humidity, humidity as min_humidity
        FROM vegetables
        ORDER BY veg_id ASC
        LIMIT 200
      `);
    }
    
    const allRows = [...milkRows, ...vegRows].sort((a, b) => new Date(a.time) - new Date(b.time));
    
    console.log(`📊 All History API: Returned ${allRows.length} total hourly readings`);
    res.json(allRows);
  } catch (error) {
    console.error('❌ All history endpoint error:', error && error.message ? error.message : error);
    if (error && error.code) console.error('SQL Error Code:', error.code);
    if (error && error.sqlMessage) console.error('SQL Message:', error.sqlMessage);
    res.status(500).json({ error: error.message || 'Internal Server Error', sqlError: error.sqlMessage || null });
  }
});

// Start server
(async () => {
  await verifySchema();
  app.listen(3000, () => {
    console.log('🚀 Server running on http://localhost:3000');
  });
})();