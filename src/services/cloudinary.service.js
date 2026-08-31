import { cloudinary } from '../config/cloudinary.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Upload a file buffer to Cloudinary
 * @param {Buffer} buffer - File buffer
 * @param {Object} options - Cloudinary upload options
 * @returns {Promise<Object>} - Cloudinary upload result
 */
export const uploadToCloudinary = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || 'hrms',
        resource_type: options.resourceType || 'auto',
        ...options,
      },
      (error, result) => {
        if (error) reject(new ApiError(500, `Cloudinary upload failed: ${error.message}`));
        else resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};
/**
 * Upload a base64 data URI or string to Cloudinary
 * @param {string} base64String - Base64 data URI (e.g. data:image/jpeg;base64,...)
 * @param {Object} options - Cloudinary upload options
 * @returns {Promise<Object>} - Cloudinary upload result
 */
export const uploadBase64ToCloudinary = async (base64String, options = {}) => {
  try {
    const result = await cloudinary.uploader.upload(base64String, {
      folder: options.folder || 'hrms',
      resource_type: options.resourceType || 'auto',
      ...options,
    });
    return result;
  } catch (error) {
    throw new ApiError(500, `Cloudinary upload failed: ${error.message}`);
  }
};

/**
 * Delete a file from Cloudinary by public_id
 */
export const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId);
};

/**
 * Extract public_id from a Cloudinary URL including folder structures
 */
export const getPublicIdFromUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  try {
    const uploadIndex = url.indexOf('/upload/');
    if (uploadIndex === -1) return null;
    let path = url.substring(uploadIndex + 8);
    path = path.replace(/^v\d+\//, '');
    const dotIndex = path.lastIndexOf('.');
    if (dotIndex !== -1) {
      path = path.substring(0, dotIndex);
    }
    return path;
  } catch {
    return null;
  }
};

