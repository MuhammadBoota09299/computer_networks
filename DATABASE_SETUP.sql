CREATE DATABASE cold_storage;
USE cold_storage;

CREATE TABLE storage_units (
    unit_id INT AUTO_INCREMENT PRIMARY KEY,
    unit_name VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO storage_units (unit_name) VALUES ('Vegetables'), ('Milk');

CREATE TABLE vegetables (
    veg_id INT AUTO_INCREMENT PRIMARY KEY,
    unit_id INT NOT NULL,
    temperature DECIMAL(5,2) NOT NULL,
    humidity DECIMAL(5,2) NOT NULL,
    server_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (unit_id) REFERENCES storage_units(unit_id)
);

CREATE TABLE milk (
    milk_id INT AUTO_INCREMENT PRIMARY KEY,
    unit_id INT NOT NULL,
    temperature DECIMAL(5,2) NOT NULL,
    humidity DECIMAL(5,2) NOT NULL,
    server_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (unit_id) REFERENCES storage_units(unit_id)
);