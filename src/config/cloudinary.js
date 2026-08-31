import { v2 as cloudinary } from 'cloudinary';
import { config } from './index.js';

const clean = (val) => (typeof val === 'string' ? val.replace(/^["']|["']$/g, '').trim() : val);

cloudinary.config({
  cloud_name: clean(config.cloudinary.cloudName),
  api_key: clean(config.cloudinary.apiKey),
  api_secret: clean(config.cloudinary.apiSecret),
});

export { cloudinary };



