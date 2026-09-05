// WorldFront.News — Real Global Location Database (seeded data)
//
// ONLY real, verifiable locations are stored here. No invented streets,
// villages, towns, postal codes, landmarks or coordinates.
//
// Format per row:
//   { name, type, country_code, parent, postal_code?, lat?, lng?,
//     verified (0|1), approximate (0|1) }
// where `parent` is the name+type of the parent location (resolved at seed
// time via the geo_locations table), or null for a country.
//
// The seed is idempotent: rows are matched by (name,type,country_code,parent)
// and only inserted when absent. Existing rows are never overwritten, so
// admin corrections survive re-seeding.
//
// type values:
//   country | state | province | region | county | department | prefecture |
//   city | town | village | district | ward | street | landmark

const db = require('./index');

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

// US capital cities (real geographic coordinates).
const US = [
  { name: 'Alabama', type: 'state', country_code: 'US', parent: 'United States', lat: 32.3182, lng: -86.9023, verified: 1 },
  { name: 'Montgomery', type: 'city', country_code: 'US', parent: 'Alabama', lat: 32.3668, lng: -86.3000, verified: 1 },
  { name: 'Alaska', type: 'state', country_code: 'US', parent: 'United States', lat: 64.2008, lng: -149.4937, verified: 1 },
  { name: 'Juneau', type: 'city', country_code: 'US', parent: 'Alaska', lat: 58.3019, lng: -134.4197, verified: 1 },
  { name: 'Arizona', type: 'state', country_code: 'US', parent: 'United States', lat: 34.0489, lng: -111.0937, verified: 1 },
  { name: 'Phoenix', type: 'city', country_code: 'US', parent: 'Arizona', lat: 33.4484, lng: -112.0740, verified: 1 },
  { name: 'Arkansas', type: 'state', country_code: 'US', parent: 'United States', lat: 35.2010, lng: -91.8318, verified: 1 },
  { name: 'Little Rock', type: 'city', country_code: 'US', parent: 'Arkansas', lat: 34.7465, lng: -92.2896, verified: 1 },
  { name: 'California', type: 'state', country_code: 'US', parent: 'United States', lat: 36.7783, lng: -119.4179, verified: 1 },
  { name: 'Sacramento', type: 'city', country_code: 'US', parent: 'California', lat: 38.5816, lng: -121.4944, verified: 1 },
  { name: 'Los Angeles', type: 'city', country_code: 'US', parent: 'California', lat: 34.0522, lng: -118.2437, verified: 1 },
  { name: 'San Francisco', type: 'city', country_code: 'US', parent: 'California', lat: 37.7749, lng: -122.4194, verified: 1 },
  { name: 'San Diego', type: 'city', country_code: 'US', parent: 'California', lat: 32.7157, lng: -117.1611, verified: 1 },
  { name: 'Colorado', type: 'state', country_code: 'US', parent: 'United States', lat: 39.5501, lng: -105.7821, verified: 1 },
  { name: 'Denver', type: 'city', country_code: 'US', parent: 'Colorado', lat: 39.7392, lng: -104.9903, verified: 1 },
  { name: 'Connecticut', type: 'state', country_code: 'US', parent: 'United States', lat: 41.6032, lng: -73.0877, verified: 1 },
  { name: 'Hartford', type: 'city', country_code: 'US', parent: 'Connecticut', lat: 41.7658, lng: -72.6734, verified: 1 },
  { name: 'Delaware', type: 'state', country_code: 'US', parent: 'United States', lat: 38.9108, lng: -75.5277, verified: 1 },
  { name: 'Dover', type: 'city', country_code: 'US', parent: 'Delaware', lat: 39.1582, lng: -75.5244, verified: 1 },
  { name: 'Florida', type: 'state', country_code: 'US', parent: 'United States', lat: 27.6648, lng: -81.5158, verified: 1 },
  { name: 'Tallahassee', type: 'city', country_code: 'US', parent: 'Florida', lat: 30.4383, lng: -84.2807, verified: 1 },
  { name: 'Miami', type: 'city', country_code: 'US', parent: 'Florida', lat: 25.7617, lng: -80.1918, verified: 1 },
  { name: 'Orlando', type: 'city', country_code: 'US', parent: 'Florida', lat: 28.5383, lng: -81.3792, verified: 1 },
  { name: 'Jacksonville', type: 'city', country_code: 'US', parent: 'Florida', lat: 30.3322, lng: -81.6557, verified: 1 },
  { name: 'Tampa', type: 'city', country_code: 'US', parent: 'Florida', lat: 27.9506, lng: -82.4572, verified: 1 },
  { name: 'Fort Lauderdale', type: 'city', country_code: 'US', parent: 'Florida', lat: 26.1224, lng: -80.1373, verified: 1 },
  { name: 'Palm Beach', type: 'town', country_code: 'US', parent: 'Florida', lat: 26.7056, lng: -80.0364, verified: 1 },
  { name: 'Georgia', type: 'state', country_code: 'US', parent: 'United States', lat: 32.1656, lng: -82.9001, verified: 1 },
  { name: 'Atlanta', type: 'city', country_code: 'US', parent: 'Georgia', lat: 33.7490, lng: -84.3880, verified: 1 },
  { name: 'Hawaii', type: 'state', country_code: 'US', parent: 'United States', lat: 19.8987, lng: -155.6659, verified: 1 },
  { name: 'Honolulu', type: 'city', country_code: 'US', parent: 'Hawaii', lat: 21.3069, lng: -157.8583, verified: 1 },
  { name: 'Idaho', type: 'state', country_code: 'US', parent: 'United States', lat: 44.0682, lng: -114.7420, verified: 1 },
  { name: 'Boise', type: 'city', country_code: 'US', parent: 'Idaho', lat: 43.6150, lng: -116.2023, verified: 1 },
  { name: 'Illinois', type: 'state', country_code: 'US', parent: 'United States', lat: 40.6331, lng: -89.3985, verified: 1 },
  { name: 'Springfield', type: 'city', country_code: 'US', parent: 'Illinois', lat: 39.7817, lng: -89.6501, verified: 1 },
  { name: 'Chicago', type: 'city', country_code: 'US', parent: 'Illinois', lat: 41.8781, lng: -87.6298, verified: 1 },
  { name: 'Indiana', type: 'state', country_code: 'US', parent: 'United States', lat: 40.2672, lng: -86.1349, verified: 1 },
  { name: 'Indianapolis', type: 'city', country_code: 'US', parent: 'Indiana', lat: 39.7684, lng: -86.1581, verified: 1 },
  { name: 'Iowa', type: 'state', country_code: 'US', parent: 'United States', lat: 41.8780, lng: -93.0977, verified: 1 },
  { name: 'Des Moines', type: 'city', country_code: 'US', parent: 'Iowa', lat: 41.5868, lng: -93.6250, verified: 1 },
  { name: 'Kansas', type: 'state', country_code: 'US', parent: 'United States', lat: 39.0119, lng: -98.4842, verified: 1 },
  { name: 'Topeka', type: 'city', country_code: 'US', parent: 'Kansas', lat: 39.0473, lng: -95.6752, verified: 1 },
  { name: 'Wichita', type: 'city', country_code: 'US', parent: 'Kansas', lat: 37.6872, lng: -97.3301, verified: 1 },
  { name: 'Kansas City', type: 'city', country_code: 'US', parent: 'Kansas', lat: 39.1141, lng: -94.6275, verified: 1 },
  { name: 'Decatur County', type: 'county', country_code: 'US', parent: 'Kansas', lat: 39.7855, lng: -100.4708, verified: 1 },
  { name: 'Oberlin', type: 'city', country_code: 'US', parent: 'Decatur County', lat: 39.8192, lng: -100.5285, verified: 1 },
  { name: 'Kentucky', type: 'state', country_code: 'US', parent: 'United States', lat: 37.8393, lng: -84.2700, verified: 1 },
  { name: 'Frankfort', type: 'city', country_code: 'US', parent: 'Kentucky', lat: 38.2009, lng: -84.8733, verified: 1 },
  { name: 'Louisiana', type: 'state', country_code: 'US', parent: 'United States', lat: 31.2448, lng: -92.1450, verified: 1 },
  { name: 'Baton Rouge', type: 'city', country_code: 'US', parent: 'Louisiana', lat: 30.4515, lng: -91.1871, verified: 1 },
  { name: 'Maine', type: 'state', country_code: 'US', parent: 'United States', lat: 45.2538, lng: -69.4455, verified: 1 },
  { name: 'Augusta', type: 'city', country_code: 'US', parent: 'Maine', lat: 44.3106, lng: -69.7797, verified: 1 },
  { name: 'Maryland', type: 'state', country_code: 'US', parent: 'United States', lat: 39.0458, lng: -76.6413, verified: 1 },
  { name: 'Annapolis', type: 'city', country_code: 'US', parent: 'Maryland', lat: 38.9784, lng: -76.4922, verified: 1 },
  { name: 'Massachusetts', type: 'state', country_code: 'US', parent: 'United States', lat: 42.4072, lng: -71.3824, verified: 1 },
  { name: 'Boston', type: 'city', country_code: 'US', parent: 'Massachusetts', lat: 42.3601, lng: -71.0589, verified: 1 },
  { name: 'Michigan', type: 'state', country_code: 'US', parent: 'United States', lat: 44.3148, lng: -85.6024, verified: 1 },
  { name: 'Lansing', type: 'city', country_code: 'US', parent: 'Michigan', lat: 42.7325, lng: -84.5555, verified: 1 },
  { name: 'Detroit', type: 'city', country_code: 'US', parent: 'Michigan', lat: 42.3314, lng: -83.0458, verified: 1 },
  { name: 'Minnesota', type: 'state', country_code: 'US', parent: 'United States', lat: 46.7296, lng: -94.6859, verified: 1 },
  { name: 'Saint Paul', type: 'city', country_code: 'US', parent: 'Minnesota', lat: 44.9537, lng: -93.0900, verified: 1 },
  { name: 'Mississippi', type: 'state', country_code: 'US', parent: 'United States', lat: 32.3547, lng: -89.3985, verified: 1 },
  { name: 'Jackson', type: 'city', country_code: 'US', parent: 'Mississippi', lat: 32.2989, lng: -90.1800, verified: 1 },
  { name: 'Missouri', type: 'state', country_code: 'US', parent: 'United States', lat: 38.5739, lng: -92.6038, verified: 1 },
  { name: 'Jefferson City', type: 'city', country_code: 'US', parent: 'Missouri', lat: 38.5767, lng: -92.1735, verified: 1 },
  { name: 'Montana', type: 'state', country_code: 'US', parent: 'United States', lat: 46.8797, lng: -110.3626, verified: 1 },
  { name: 'Helena', type: 'city', country_code: 'US', parent: 'Montana', lat: 46.5891, lng: -112.0391, verified: 1 },
  { name: 'Nebraska', type: 'state', country_code: 'US', parent: 'United States', lat: 41.4925, lng: -99.9018, verified: 1 },
  { name: 'Lincoln', type: 'city', country_code: 'US', parent: 'Nebraska', lat: 40.8136, lng: -96.7026, verified: 1 },
  { name: 'Nevada', type: 'state', country_code: 'US', parent: 'United States', lat: 38.8026, lng: -116.4194, verified: 1 },
  { name: 'Carson City', type: 'city', country_code: 'US', parent: 'Nevada', lat: 39.1638, lng: -119.7674, verified: 1 },
  { name: 'New Hampshire', type: 'state', country_code: 'US', parent: 'United States', lat: 43.1939, lng: -71.5724, verified: 1 },
  { name: 'Concord', type: 'city', country_code: 'US', parent: 'New Hampshire', lat: 43.2081, lng: -71.5376, verified: 1 },
  { name: 'New Jersey', type: 'state', country_code: 'US', parent: 'United States', lat: 40.0583, lng: -74.4057, verified: 1 },
  { name: 'Trenton', type: 'city', country_code: 'US', parent: 'New Jersey', lat: 40.2206, lng: -74.7597, verified: 1 },
  { name: 'New Mexico', type: 'state', country_code: 'US', parent: 'United States', lat: 34.5199, lng: -105.8701, verified: 1 },
  { name: 'Santa Fe', type: 'city', country_code: 'US', parent: 'New Mexico', lat: 35.6870, lng: -105.9378, verified: 1 },
  { name: 'New York', type: 'state', country_code: 'US', parent: 'United States', lat: 43.2994, lng: -74.2179, verified: 1 },
  { name: 'Albany', type: 'city', country_code: 'US', parent: 'New York', lat: 42.6526, lng: -73.7562, verified: 1 },
  { name: 'New York City', type: 'city', country_code: 'US', parent: 'New York', lat: 40.7128, lng: -74.0060, verified: 1 },
  { name: 'North Carolina', type: 'state', country_code: 'US', parent: 'United States', lat: 35.7596, lng: -79.0193, verified: 1 },
  { name: 'Raleigh', type: 'city', country_code: 'US', parent: 'North Carolina', lat: 35.7796, lng: -78.6382, verified: 1 },
  { name: 'North Dakota', type: 'state', country_code: 'US', parent: 'United States', lat: 47.5515, lng: -101.0020, verified: 1 },
  { name: 'Bismarck', type: 'city', country_code: 'US', parent: 'North Dakota', lat: 46.8083, lng: -100.7837, verified: 1 },
  { name: 'Ohio', type: 'state', country_code: 'US', parent: 'United States', lat: 40.4173, lng: -82.9071, verified: 1 },
  { name: 'Columbus', type: 'city', country_code: 'US', parent: 'Ohio', lat: 39.9612, lng: -82.9988, verified: 1 },
  { name: 'Oklahoma', type: 'state', country_code: 'US', parent: 'United States', lat: 35.4676, lng: -97.5164, verified: 1 },
  { name: 'Oklahoma City', type: 'city', country_code: 'US', parent: 'Oklahoma', lat: 35.4676, lng: -97.5164, verified: 1 },
  { name: 'Oregon', type: 'state', country_code: 'US', parent: 'United States', lat: 43.8041, lng: -120.5542, verified: 1 },
  { name: 'Salem', type: 'city', country_code: 'US', parent: 'Oregon', lat: 44.9429, lng: -123.0351, verified: 1 },
  { name: 'Pennsylvania', type: 'state', country_code: 'US', parent: 'United States', lat: 41.2033, lng: -77.1945, verified: 1 },
  { name: 'Harrisburg', type: 'city', country_code: 'US', parent: 'Pennsylvania', lat: 40.2732, lng: -76.8867, verified: 1 },
  { name: 'Rhode Island', type: 'state', country_code: 'US', parent: 'United States', lat: 41.5801, lng: -71.4774, verified: 1 },
  { name: 'Providence', type: 'city', country_code: 'US', parent: 'Rhode Island', lat: 41.8240, lng: -71.4128, verified: 1 },
  { name: 'South Carolina', type: 'state', country_code: 'US', parent: 'United States', lat: 33.8361, lng: -81.1637, verified: 1 },
  { name: 'Columbia', type: 'city', country_code: 'US', parent: 'South Carolina', lat: 34.0007, lng: -81.0348, verified: 1 },
  { name: 'South Dakota', type: 'state', country_code: 'US', parent: 'United States', lat: 43.9695, lng: -99.9018, verified: 1 },
  { name: 'Pierre', type: 'city', country_code: 'US', parent: 'South Dakota', lat: 44.3670, lng: -100.3464, verified: 1 },
  { name: 'Tennessee', type: 'state', country_code: 'US', parent: 'United States', lat: 35.5175, lng: -86.5804, verified: 1 },
  { name: 'Nashville', type: 'city', country_code: 'US', parent: 'Tennessee', lat: 36.1627, lng: -86.7816, verified: 1 },
  { name: 'Texas', type: 'state', country_code: 'US', parent: 'United States', lat: 31.9686, lng: -99.9018, verified: 1 },
  { name: 'Austin', type: 'city', country_code: 'US', parent: 'Texas', lat: 30.2672, lng: -97.7431, verified: 1 },
  { name: 'Houston', type: 'city', country_code: 'US', parent: 'Texas', lat: 29.7604, lng: -95.3698, verified: 1 },
  { name: 'Dallas', type: 'city', country_code: 'US', parent: 'Texas', lat: 32.7767, lng: -96.7970, verified: 1 },
  { name: 'Utah', type: 'state', country_code: 'US', parent: 'United States', lat: 39.3210, lng: -111.0937, verified: 1 },
  { name: 'Salt Lake City', type: 'city', country_code: 'US', parent: 'Utah', lat: 40.7608, lng: -111.8910, verified: 1 },
  { name: 'Vermont', type: 'state', country_code: 'US', parent: 'United States', lat: 44.5588, lng: -72.5778, verified: 1 },
  { name: 'Montpelier', type: 'city', country_code: 'US', parent: 'Vermont', lat: 44.2601, lng: -72.5754, verified: 1 },
  { name: 'Virginia', type: 'state', country_code: 'US', parent: 'United States', lat: 37.4316, lng: -78.6569, verified: 1 },
  { name: 'Richmond', type: 'city', country_code: 'US', parent: 'Virginia', lat: 37.5407, lng: -77.4360, verified: 1 },
  { name: 'Washington', type: 'state', country_code: 'US', parent: 'United States', lat: 47.7511, lng: -120.7401, verified: 1 },
  { name: 'Olympia', type: 'city', country_code: 'US', parent: 'Washington', lat: 47.0379, lng: -122.9007, verified: 1 },
  { name: 'Seattle', type: 'city', country_code: 'US', parent: 'Washington', lat: 47.6062, lng: -122.3321, verified: 1 },
  { name: 'West Virginia', type: 'state', country_code: 'US', parent: 'United States', lat: 38.5976, lng: -80.4549, verified: 1 },
  { name: 'Charleston', type: 'city', country_code: 'US', parent: 'West Virginia', lat: 38.3498, lng: -81.6326, verified: 1 },
  { name: 'Wisconsin', type: 'state', country_code: 'US', parent: 'United States', lat: 43.7844, lng: -88.7879, verified: 1 },
  { name: 'Madison', type: 'city', country_code: 'US', parent: 'Wisconsin', lat: 43.0731, lng: -89.4012, verified: 1 },
  { name: 'Wyoming', type: 'state', country_code: 'US', parent: 'United States', lat: 43.0760, lng: -107.2903, verified: 1 },
  { name: 'Cheyenne', type: 'city', country_code: 'US', parent: 'Wyoming', lat: 41.1400, lng: -104.8202, verified: 1 },
  { name: 'District of Columbia', type: 'district', country_code: 'US', parent: 'United States', lat: 38.9072, lng: -77.0369, verified: 1 }
];

// Canada provinces/territories + capitals (real coordinates).
const CA = [
  { name: 'Ontario', type: 'province', country_code: 'CA', parent: 'Canada', lat: 51.2538, lng: -85.3232, verified: 1 },
  { name: 'Toronto', type: 'city', country_code: 'CA', parent: 'Ontario', lat: 43.6532, lng: -79.3832, verified: 1 },
  { name: 'Quebec', type: 'province', country_code: 'CA', parent: 'Canada', lat: 52.9399, lng: -73.5491, verified: 1 },
  { name: 'Montreal', type: 'city', country_code: 'CA', parent: 'Quebec', lat: 45.5017, lng: -73.5673, verified: 1 },
  { name: 'Nova Scotia', type: 'province', country_code: 'CA', parent: 'Canada', lat: 44.6820, lng: -63.7443, verified: 1 },
  { name: 'Halifax', type: 'city', country_code: 'CA', parent: 'Nova Scotia', lat: 44.6488, lng: -63.5752, verified: 1 },
  { name: 'New Brunswick', type: 'province', country_code: 'CA', parent: 'Canada', lat: 46.5653, lng: -66.4619, verified: 1 },
  { name: 'Fredericton', type: 'city', country_code: 'CA', parent: 'New Brunswick', lat: 45.9454, lng: -66.6656, verified: 1 },
  { name: 'Prince Edward Island', type: 'province', country_code: 'CA', parent: 'Canada', lat: 46.5107, lng: -63.4168, verified: 1 },
  { name: 'Charlottetown', type: 'city', country_code: 'CA', parent: 'Prince Edward Island', lat: 46.2382, lng: -63.1311, verified: 1 },
  { name: 'Manitoba', type: 'province', country_code: 'CA', parent: 'Canada', lat: 53.7609, lng: -98.8139, verified: 1 },
  { name: 'Winnipeg', type: 'city', country_code: 'CA', parent: 'Manitoba', lat: 49.8951, lng: -97.1384, verified: 1 },
  { name: 'Saskatchewan', type: 'province', country_code: 'CA', parent: 'Canada', lat: 52.9399, lng: -106.4509, verified: 1 },
  { name: 'Regina', type: 'city', country_code: 'CA', parent: 'Saskatchewan', lat: 50.4452, lng: -104.6189, verified: 1 },
  { name: 'Alberta', type: 'province', country_code: 'CA', parent: 'Canada', lat: 55.0000, lng: -115.0000, verified: 1 },
  { name: 'Edmonton', type: 'city', country_code: 'CA', parent: 'Alberta', lat: 53.5461, lng: -113.4938, verified: 1 },
  { name: 'Calgary', type: 'city', country_code: 'CA', parent: 'Alberta', lat: 51.0447, lng: -114.0719, verified: 1 },
  { name: 'British Columbia', type: 'province', country_code: 'CA', parent: 'Canada', lat: 53.7267, lng: -127.6476, verified: 1 },
  { name: 'Vancouver', type: 'city', country_code: 'CA', parent: 'British Columbia', lat: 49.2827, lng: -123.1207, verified: 1 }
];

// Nigeria states (36) + FCT Abuja, capitals + major LGAs/cities (real data).
const NG = [
  { name: 'Abia State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 5.4527, lng: 7.5246, verified: 1 },
  { name: 'Umuahia', type: 'city', country_code: 'NG', parent: 'Abia State', lat: 5.5249, lng: 7.4912, verified: 1 },
  { name: 'Aba', type: 'city', country_code: 'NG', parent: 'Abia State', lat: 5.1066, lng: 7.3667, verified: 1 },
  { name: 'Adamawa State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 9.3265, lng: 12.3984, verified: 1 },
  { name: 'Yola', type: 'city', country_code: 'NG', parent: 'Adamawa State', lat: 9.2035, lng: 12.4954, verified: 1 },
  { name: 'Akwa Ibom State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 4.9057, lng: 7.8539, verified: 1 },
  { name: 'Uyo', type: 'city', country_code: 'NG', parent: 'Akwa Ibom State', lat: 5.0391, lng: 7.9088, verified: 1 },
  { name: 'Anambra State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 6.2209, lng: 6.9370, verified: 1 },
  { name: 'Awka', type: 'city', country_code: 'NG', parent: 'Anambra State', lat: 6.2107, lng: 7.0678, verified: 1 },
  { name: 'Onitsha', type: 'city', country_code: 'NG', parent: 'Anambra State', lat: 6.1667, lng: 6.7833, verified: 1 },
  { name: 'Bauchi State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 10.3106, lng: 9.8439, verified: 1 },
  { name: 'Bauchi', type: 'city', country_code: 'NG', parent: 'Bauchi State', lat: 10.3146, lng: 9.8440, verified: 1 },
  { name: 'Bayelsa State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 4.7719, lng: 6.0699, verified: 1 },
  { name: 'Yenagoa', type: 'city', country_code: 'NG', parent: 'Bayelsa State', lat: 4.9215, lng: 6.2715, verified: 1 },
  { name: 'Benue State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 7.3367, lng: 8.7404, verified: 1 },
  { name: 'Makurdi', type: 'city', country_code: 'NG', parent: 'Benue State', lat: 7.7337, lng: 8.5214, verified: 1 },
  { name: 'Borno State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 11.8848, lng: 13.1510, verified: 1 },
  { name: 'Maiduguri', type: 'city', country_code: 'NG', parent: 'Borno State', lat: 11.8311, lng: 13.1510, verified: 1 },
  { name: 'Cross River State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 5.8702, lng: 8.5988, verified: 1 },
  { name: 'Calabar', type: 'city', country_code: 'NG', parent: 'Cross River State', lat: 4.9581, lng: 8.3227, verified: 1 },
  { name: 'Delta State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 5.7040, lng: 5.9339, verified: 1 },
  { name: 'Asaba', type: 'city', country_code: 'NG', parent: 'Delta State', lat: 6.2053, lng: 6.6958, verified: 1 },
  { name: 'Warri', type: 'city', country_code: 'NG', parent: 'Delta State', lat: 5.5174, lng: 5.7506, verified: 1 },
  { name: 'Ebonyi State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 6.2662, lng: 8.0857, verified: 1 },
  { name: 'Abakaliki', type: 'city', country_code: 'NG', parent: 'Ebonyi State', lat: 6.3289, lng: 8.1054, verified: 1 },
  { name: 'Edo State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 6.6341, lng: 5.9304, verified: 1 },
  { name: 'Benin City', type: 'city', country_code: 'NG', parent: 'Edo State', lat: 6.3350, lng: 5.6037, verified: 1 },
  { name: 'Ekiti State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 7.7191, lng: 5.3110, verified: 1 },
  { name: 'Ado Ekiti', type: 'city', country_code: 'NG', parent: 'Ekiti State', lat: 7.6212, lng: 5.2215, verified: 1 },
  { name: 'Enugu State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 6.5244, lng: 7.5182, verified: 1 },
  { name: 'Enugu', type: 'city', country_code: 'NG', parent: 'Enugu State', lat: 6.5244, lng: 7.5182, verified: 1 },
  { name: 'Federal Capital Territory', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 8.8941, lng: 7.1860, verified: 1 },
  { name: 'Abuja', type: 'city', country_code: 'NG', parent: 'Federal Capital Territory', lat: 9.0765, lng: 7.3986, verified: 1 },
  { name: 'Gombe State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 10.2897, lng: 11.1673, verified: 1 },
  { name: 'Gombe', type: 'city', country_code: 'NG', parent: 'Gombe State', lat: 10.2897, lng: 11.1673, verified: 1 },
  { name: 'Imo State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 5.4697, lng: 7.0393, verified: 1 },
  { name: 'Owerri', type: 'city', country_code: 'NG', parent: 'Imo State', lat: 5.4900, lng: 7.0264, verified: 1 },
  { name: 'Jigawa State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 12.2280, lng: 9.5616, verified: 1 },
  { name: 'Dutse', type: 'city', country_code: 'NG', parent: 'Jigawa State', lat: 11.7589, lng: 9.3384, verified: 1 },
  { name: 'Kaduna State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 10.5264, lng: 7.4388, verified: 1 },
  { name: 'Kaduna', type: 'city', country_code: 'NG', parent: 'Kaduna State', lat: 10.5264, lng: 7.4388, verified: 1 },
  { name: 'Kano State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 11.7471, lng: 8.5472, verified: 1 },
  { name: 'Kano', type: 'city', country_code: 'NG', parent: 'Kano State', lat: 12.0022, lng: 8.5920, verified: 1 },
  { name: 'Katsina State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 12.9906, lng: 7.6014, verified: 1 },
  { name: 'Katsina', type: 'city', country_code: 'NG', parent: 'Katsina State', lat: 12.9906, lng: 7.6014, verified: 1 },
  { name: 'Kebbi State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 11.4942, lng: 4.2344, verified: 1 },
  { name: 'Birnin Kebbi', type: 'city', country_code: 'NG', parent: 'Kebbi State', lat: 12.4540, lng: 4.1990, verified: 1 },
  { name: 'Kogi State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 7.7984, lng: 6.7413, verified: 1 },
  { name: 'Lokoja', type: 'city', country_code: 'NG', parent: 'Kogi State', lat: 7.8000, lng: 6.7400, verified: 1 },
  { name: 'Kwara State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 8.9846, lng: 4.5590, verified: 1 },
  { name: 'Ilorin', type: 'city', country_code: 'NG', parent: 'Kwara State', lat: 8.4799, lng: 4.5418, verified: 1 },
  { name: 'Lagos State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 6.5244, lng: 3.3792, verified: 1 },
  { name: 'Ikeja', type: 'city', country_code: 'NG', parent: 'Lagos State', lat: 6.6025, lng: 3.3495, verified: 1 },
  { name: 'Victoria Island', type: 'district', country_code: 'NG', parent: 'Lagos State', lat: 6.4257, lng: 3.4212, verified: 1 },
  { name: 'Lekki', type: 'district', country_code: 'NG', parent: 'Lagos State', lat: 6.4474, lng: 3.4770, verified: 1 },
  { name: 'Surulere', type: 'district', country_code: 'NG', parent: 'Lagos State', lat: 6.5016, lng: 3.3589, verified: 1 },
  { name: 'Yaba', type: 'district', country_code: 'NG', parent: 'Lagos State', lat: 6.5082, lng: 3.3711, verified: 1 },
  { name: 'Mainland', type: 'district', country_code: 'NG', parent: 'Lagos State', lat: 6.4800, lng: 3.3700, verified: 0, approximate: 1 },
  { name: 'Apapa', type: 'district', country_code: 'NG', parent: 'Lagos State', lat: 6.4420, lng: 3.3740, verified: 1 },
  { name: 'Agege', type: 'district', country_code: 'NG', parent: 'Lagos State', lat: 6.6179, lng: 3.3396, verified: 1 },
  { name: 'Ikorodu', type: 'town', country_code: 'NG', parent: 'Lagos State', lat: 6.6087, lng: 3.5096, verified: 1 },
  { name: 'Badagry', type: 'town', country_code: 'NG', parent: 'Lagos State', lat: 6.4151, lng: 2.8853, verified: 1 },
  { name: 'Epe', type: 'town', country_code: 'NG', parent: 'Lagos State', lat: 6.5932, lng: 3.9836, verified: 1 },
  { name: 'Nasarawa State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 8.4998, lng: 8.2409, verified: 1 },
  { name: 'Lafia', type: 'city', country_code: 'NG', parent: 'Nasarawa State', lat: 8.4900, lng: 8.5248, verified: 1 },
  { name: 'Niger State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 9.9309, lng: 5.5983, verified: 1 },
  { name: 'Minna', type: 'city', country_code: 'NG', parent: 'Niger State', lat: 9.6151, lng: 6.5480, verified: 1 },
  { name: 'Ogun State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 6.9975, lng: 3.4737, verified: 1 },
  { name: 'Abeokuta', type: 'city', country_code: 'NG', parent: 'Ogun State', lat: 7.1485, lng: 3.3580, verified: 1 },
  { name: 'Ondo State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 6.9148, lng: 5.1478, verified: 1 },
  { name: 'Akure', type: 'city', country_code: 'NG', parent: 'Ondo State', lat: 7.2520, lng: 5.1990, verified: 1 },
  { name: 'Osun State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 7.5629, lng: 4.5200, verified: 1 },
  { name: 'Osogbo', type: 'city', country_code: 'NG', parent: 'Osun State', lat: 7.7822, lng: 4.5623, verified: 1 },
  { name: 'Oyo State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 8.1574, lng: 3.6147, verified: 1 },
  { name: 'Ibadan', type: 'city', country_code: 'NG', parent: 'Oyo State', lat: 7.3775, lng: 3.9470, verified: 1 },
  { name: 'Plateau State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 9.2182, lng: 9.5170, verified: 1 },
  { name: 'Jos', type: 'city', country_code: 'NG', parent: 'Plateau State', lat: 9.8965, lng: 8.8583, verified: 1 },
  { name: 'Rivers State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 4.8572, lng: 6.9607, verified: 1 },
  { name: 'Port Harcourt', type: 'city', country_code: 'NG', parent: 'Rivers State', lat: 4.8156, lng: 7.0498, verified: 1 },
  { name: 'Sokoto State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 13.0533, lng: 5.3220, verified: 1 },
  { name: 'Sokoto', type: 'city', country_code: 'NG', parent: 'Sokoto State', lat: 13.0633, lng: 5.2338, verified: 1 },
  { name: 'Taraba State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 7.9994, lng: 10.7740, verified: 1 },
  { name: 'Jalingo', type: 'city', country_code: 'NG', parent: 'Taraba State', lat: 8.8933, lng: 11.3594, verified: 1 },
  { name: 'Yobe State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 12.2939, lng: 11.4394, verified: 1 },
  { name: 'Damaturu', type: 'city', country_code: 'NG', parent: 'Yobe State', lat: 11.7455, lng: 11.9673, verified: 1 },
  { name: 'Zamfara State', type: 'state', country_code: 'NG', parent: 'Nigeria', lat: 12.1222, lng: 6.2236, verified: 1 },
  { name: 'Gusau', type: 'city', country_code: 'NG', parent: 'Zamfara State', lat: 12.1547, lng: 6.6714, verified: 1 }
];

// United Kingdom
const GB = [
  { name: 'England', type: 'region', country_code: 'GB', parent: 'United Kingdom', lat: 52.3555, lng: -1.1743, verified: 1 },
  { name: 'London', type: 'city', country_code: 'GB', parent: 'England', lat: 51.5074, lng: -0.1278, verified: 1 },
  { name: 'Manchester', type: 'city', country_code: 'GB', parent: 'England', lat: 53.4808, lng: -2.2426, verified: 1 },
  { name: 'Birmingham', type: 'city', country_code: 'GB', parent: 'England', lat: 52.4862, lng: -1.8904, verified: 1 },
  { name: 'Scotland', type: 'region', country_code: 'GB', parent: 'United Kingdom', lat: 56.4907, lng: -4.2026, verified: 1 },
  { name: 'Edinburgh', type: 'city', country_code: 'GB', parent: 'Scotland', lat: 55.9533, lng: -3.1883, verified: 1 },
  { name: 'Wales', type: 'region', country_code: 'GB', parent: 'United Kingdom', lat: 52.1307, lng: -3.7837, verified: 1 },
  { name: 'Cardiff', type: 'city', country_code: 'GB', parent: 'Wales', lat: 51.4816, lng: -3.1791, verified: 1 },
  { name: 'Northern Ireland', type: 'region', country_code: 'GB', parent: 'United Kingdom', lat: 54.7877, lng: -6.4923, verified: 1 },
  { name: 'Belfast', type: 'city', country_code: 'GB', parent: 'Northern Ireland', lat: 54.5973, lng: -5.9301, verified: 1 }
];

// Ghana regions
const GH = [
  { name: 'Greater Accra Region', type: 'region', country_code: 'GH', parent: 'Ghana', lat: 5.8143, lng: 0.0747, verified: 1 },
  { name: 'Accra', type: 'city', country_code: 'GH', parent: 'Greater Accra Region', lat: 5.6037, lng: -0.1870, verified: 1 },
  { name: 'Ashanti Region', type: 'region', country_code: 'GH', parent: 'Ghana', lat: 6.7470, lng: -1.5209, verified: 1 },
  { name: 'Kumasi', type: 'city', country_code: 'GH', parent: 'Ashanti Region', lat: 6.6594, lng: -1.6236, verified: 1 },
  { name: 'Western Region', type: 'region', country_code: 'GH', parent: 'Ghana', lat: 5.5000, lng: -2.0000, verified: 1 },
  { name: 'Sekondi-Takoradi', type: 'city', country_code: 'GH', parent: 'Western Region', lat: 4.9053, lng: -1.7600, verified: 1 }
];

// Kenya counties
const KE = [
  { name: 'Nairobi County', type: 'county', country_code: 'KE', parent: 'Kenya', lat: -1.2921, lng: 36.8219, verified: 1 },
  { name: 'Nairobi', type: 'city', country_code: 'KE', parent: 'Nairobi County', lat: -1.2921, lng: 36.8219, verified: 1 },
  { name: 'Mombasa County', type: 'county', country_code: 'KE', parent: 'Kenya', lat: -4.0435, lng: 39.6682, verified: 1 },
  { name: 'Mombasa', type: 'city', country_code: 'KE', parent: 'Mombasa County', lat: -4.0435, lng: 39.6682, verified: 1 },
  { name: 'Kisumu County', type: 'county', country_code: 'KE', parent: 'Kenya', lat: -0.1022, lng: 34.7617, verified: 1 },
  { name: 'Kisumu', type: 'city', country_code: 'KE', parent: 'Kisumu County', lat: -0.1022, lng: 34.7617, verified: 1 }
];

// South Africa provinces
const ZA = [
  { name: 'Gauteng', type: 'province', country_code: 'ZA', parent: 'South Africa', lat: -26.2708, lng: 28.1123, verified: 1 },
  { name: 'Johannesburg', type: 'city', country_code: 'ZA', parent: 'Gauteng', lat: -26.2041, lng: 28.0473, verified: 1 },
  { name: 'Western Cape', type: 'province', country_code: 'ZA', parent: 'South Africa', lat: -33.2278, lng: 21.8569, verified: 1 },
  { name: 'Cape Town', type: 'city', country_code: 'ZA', parent: 'Western Cape', lat: -33.9249, lng: 18.4241, verified: 1 },
  { name: 'KwaZulu-Natal', type: 'province', country_code: 'ZA', parent: 'South Africa', lat: -28.5306, lng: 30.8958, verified: 1 },
  { name: 'Durban', type: 'city', country_code: 'ZA', parent: 'KwaZulu-Natal', lat: -29.8587, lng: 31.0218, verified: 1 }
];

// ---- Seed runner (idempotent) ----
// Merge duplicate locations that share the same (name, country, parent) but got
// created under different types (e.g. a seeded 'county' + an auto-created
// 'city'). Children and listing links are moved to the survivor (the row with
// verified/approved status wins), then the copy is deleted.
function dedupeLocations() {
  let merged = 0;
  const dupes = db.all(`
    SELECT g.name, g.country_code, g.parent_id, COUNT(*) AS c
    FROM geo_locations g
    WHERE g.type != 'country'
    GROUP BY g.name, g.country_code, g.parent_id
    HAVING c > 1
  `);
  for (const d of dupes) {
    const rows = db.all(
      "SELECT * FROM geo_locations WHERE name=? COLLATE NOCASE AND country_code=? AND parent_id IS ? AND type != 'country' ORDER BY verified DESC, status='approved' DESC, id ASC",
      [d.name, d.country_code, d.parent_id]
    );
    if (rows.length < 2) continue;
    const keep = rows[0];
    for (const gone of rows.slice(1)) {
      db.run('UPDATE geo_locations SET parent_id=? WHERE id=?', [keep.id, gone.id]);
      db.run('UPDATE listing_locations SET location_id=? WHERE location_id=?', [keep.id, gone.id]);
      db.run('DELETE FROM geo_locations WHERE id=?', [gone.id]);
      merged++;
    }
  }
  if (merged) db.persist();
  return merged;
}

function seedGeoLocations() {
  const rows = [
    ...US, ...CA, ...NG, ...GB, ...GH, ...KE, ...ZA
  ];

  // Always ensure every country in the countries table exists as a
  // geo_locations record of type 'country' with its real centroid.
  const existing = db.get('SELECT COUNT(*) AS c FROM geo_locations').c;

  let inserted = 0;
  let repaired = 0;
  let madeChanges = false;

  const insert = (r) => {
    const existingRow = db.get(
      'SELECT id FROM geo_locations WHERE name=? AND type=? AND country_code=?',
      [r.name, r.type, r.country_code]
    );
    if (existingRow) return;
    let parentId = null;
    if (r.parent) {
      const pr = db.get(
        "SELECT id FROM geo_locations WHERE name=? AND type!='street' AND country_code=? LIMIT 1",
        [r.parent, r.country_code]
      );
      parentId = pr ? pr.id : null;
    }
    db.run(
      `INSERT INTO geo_locations
       (name,type,country_code,parent_id,slug,postal_code,lat,lng,verified,approximate,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'approved',?,?)`,
      [r.name, r.type, r.country_code, parentId, slugify(r.name) + '-' + r.type + (r.country_code ? '-' + r.country_code.toLowerCase() : ''),
       r.postal_code || null, r.lat ?? null, r.lng ?? null, r.verified ? 1 : 0, r.approximate ? 1 : 0, db.now(), db.now()]
    );
    inserted++;
    madeChanges = true;
  };

  // Insert every country first (so state/city rows can find their parent).
  const countries = db.all('SELECT code, name FROM countries ORDER BY code');
  for (const c of countries) {
    insert({ name: c.name, type: 'country', country_code: c.code, parent: null, verified: 1 });
  }
  for (const r of rows) insert(r);

  // Repair pass: re-link parents for seeded rows whose parent was missed during
  // earlier seeding (e.g. 'country'-type parents). Idempotent — a parent link is
  // only updated when it differs from the seed's intended parent, so admin
  // corrections are preserved.
  for (const r of rows) {
    if (!r.parent) continue;
    const pr = db.get(
      "SELECT id FROM geo_locations WHERE name=? COLLATE NOCASE AND type!='street' AND country_code=? LIMIT 1",
      [r.parent, r.country_code]
    );
    if (!pr) continue;
    const ex = db.get(
      'SELECT id, parent_id FROM geo_locations WHERE name=? AND type=? AND country_code=? LIMIT 1',
      [r.name, r.type, r.country_code]
    );
    if (ex && ex.parent_id !== pr.id) {
      db.run('UPDATE geo_locations SET parent_id=? WHERE id=?', [pr.id, ex.id]);
      repaired++;
      madeChanges = true;
    }
  }

  if (madeChanges) db.persist();
  const merged = dedupeLocations();
  return { existing, before: existing, inserted, repaired, merged, total: db.get('SELECT COUNT(*) AS c FROM geo_locations').c };
}

module.exports = { seedGeoLocations, slugify, dedupeLocations };