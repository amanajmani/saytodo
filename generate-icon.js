/**
 * Generates a 512x512 PNG app icon using Canvas.
 * Run: node generate-icon.js
 * Requires: npm install canvas (dev only, not needed at runtime)
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const size = 512;
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');

// Background: dark rounded square
const radius = 110;
ctx.beginPath();
ctx.moveTo(radius, 0);
ctx.lineTo(size - radius, 0);
ctx.quadraticCurveTo(size, 0, size, radius);
ctx.lineTo(size, size - radius);
ctx.quadraticCurveTo(size, size, size - radius, size);
ctx.lineTo(radius, size);
ctx.quadraticCurveTo(0, size, 0, size - radius);
ctx.lineTo(0, radius);
ctx.quadraticCurveTo(0, 0, radius, 0);
ctx.closePath();

// Gradient background
const bgGrad = ctx.createLinearGradient(0, 0, size, size);
bgGrad.addColorStop(0, '#1a1a2e');
bgGrad.addColorStop(1, '#16213e');
ctx.fillStyle = bgGrad;
ctx.fill();

// Microphone body
const micX = size / 2;
const micTopY = 130;
const micWidth = 70;
const micHeight = 160;
const micRadius = micWidth;

// Purple gradient for mic
const micGrad = ctx.createLinearGradient(micX - micWidth, micTopY, micX + micWidth, micTopY + micHeight);
micGrad.addColorStop(0, '#8b5cf6');
micGrad.addColorStop(1, '#a78bfa');

// Mic body (rounded rect)
ctx.beginPath();
ctx.moveTo(micX - micWidth, micTopY + micRadius);
ctx.lineTo(micX - micWidth, micTopY + micHeight);
ctx.quadraticCurveTo(micX - micWidth, micTopY + micHeight + micRadius, micX, micTopY + micHeight + micRadius);
ctx.quadraticCurveTo(micX + micWidth, micTopY + micHeight + micRadius, micX + micWidth, micTopY + micHeight);
ctx.lineTo(micX + micWidth, micTopY + micRadius);
ctx.quadraticCurveTo(micX + micWidth, micTopY, micX, micTopY);
ctx.quadraticCurveTo(micX - micWidth, micTopY, micX - micWidth, micTopY + micRadius);
ctx.closePath();
ctx.fillStyle = micGrad;
ctx.fill();

// Mic grille lines
ctx.strokeStyle = 'rgba(255,255,255,0.15)';
ctx.lineWidth = 2;
for (let y = micTopY + 50; y < micTopY + micHeight + 30; y += 22) {
  ctx.beginPath();
  ctx.moveTo(micX - micWidth + 20, y);
  ctx.lineTo(micX + micWidth - 20, y);
  ctx.stroke();
}

// Outer arc (mic holder)
const arcY = micTopY + micHeight + 40;
const arcRadius = micWidth + 40;
ctx.beginPath();
ctx.arc(micX, arcY, arcRadius, 0, Math.PI, false);
ctx.strokeStyle = '#8b5cf6';
ctx.lineWidth = 10;
ctx.lineCap = 'round';
ctx.stroke();

// Stand
const standTop = arcY + arcRadius - 5;
const standBottom = standTop + 50;
ctx.beginPath();
ctx.moveTo(micX, standTop);
ctx.lineTo(micX, standBottom);
ctx.strokeStyle = '#8b5cf6';
ctx.lineWidth = 10;
ctx.stroke();

// Base
ctx.beginPath();
ctx.moveTo(micX - 50, standBottom);
ctx.lineTo(micX + 50, standBottom);
ctx.strokeStyle = '#8b5cf6';
ctx.lineWidth = 10;
ctx.lineCap = 'round';
ctx.stroke();

// Save
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(path.join(__dirname, 'assets', 'icon.png'), buffer);
console.log('Icon generated: assets/icon.png (512x512)');
