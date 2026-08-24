/**
 * geo.service.js
 * Re-exports the geo utilities from office.service.js for backward compatibility.
 * The office coordinates are now stored in the Office model (DB) rather than hardcoded config.
 */
export { distanceInMeters, isWithinOffice, getActiveOffice } from './office.service.js';
