// 1. Initialize Map
const map = L.map('map').setView([39.8283, -98.5795], 4);

// ==========================================
// BASE MAP LAYERS
// ==========================================
const streetMap = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});

const satelliteMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
});

satelliteMap.addTo(map);

// ==========================================
// FEATURE 2: NOAA Radar Overlay Layer
// ==========================================
const noaaRadarLayer = L.tileLayer.wms(
  'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_cref_qcd/ows',
  {
    layers: 'conus_cref_qcd',
    format: 'image/png',
    transparent: true,
    opacity: 0.65,
    attribution: 'Radar Data &copy; <a href="https://radar.weather.gov/">NOAA / NWS</a>'
  }
);

// Add NOAA Radar to map by default
noaaRadarLayer.addTo(map);

// ==========================================
// LAYER CONTROL (BASE MAPS + OVERLAYS)
// ==========================================
const baseMaps = {
  "Satellite": satelliteMap,
  "Street Map": streetMap
};

const overlayMaps = {
  "NOAA Weather Radar": noaaRadarLayer
};

// Registering as overlay ensures switching base maps leaves radar intact
L.control.layers(baseMaps, overlayMaps).addTo(map);

// Keep radar on top whenever user changes base map
map.on('baselayerchange', function () {
  if (map.hasLayer(noaaRadarLayer)) {
    noaaRadarLayer.bringToFront();
  }
});

// ==========================================
// API & STATE VARIABLES
// ==========================================
const apiKey = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImU3NWUwNDFmNjg5MjRmNDE5Y2EyNWQ4YmFiZmJjZjVkIiwiaCI6Im11cm11cjY0In0=';

let startPoint = null;
let startMarker = null;
let endMarker = null;
let routeLayer = null;
let watchId = null;
let isLiveGpsActive = false;

// ==========================================
// FEATURE 1: Continuous Live GPS Tracking
// ==========================================
function toggleLiveGPS(enable) {
  isLiveGpsActive = enable;

  if (enable) {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      document.getElementById('gps-toggle').checked = false;
      return;
    }

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        startPoint = [lng, lat];

        if (!startMarker) {
          startMarker = L.marker([lat, lng])
            .addTo(map)
            .bindPopup("<b>Your Live Location</b>");
          map.setView([lat, lng], 13);
        } else {
          startMarker.setLatLng([lat, lng]);
        }

        if (endMarker) {
          fetchRoute(startPoint, [endMarker.getLatLng().lng, endMarker.getLatLng().lat]);
        } else {
          document.getElementById('summary').innerText = 'Live GPS active. Click any location on the map to set your destination.';
        }
      },
      (error) => {
        console.error("GPS Watch Error:", error);
        alert("Unable to track live location. Check browser permissions.");
        toggleLiveGPS(false);
        document.getElementById('gps-toggle').checked = false;
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 20000
      }
    );
  } else {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    resetAll();
    document.getElementById('summary').innerText = 'GPS inactive. Turn on Live GPS to select a destination.';
  }
}

// ==========================================
// FEATURE 3: NWS Tornado Warnings & Watches
// ==========================================
function loadNWSAlerts() {
  const nwsUrl = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';

  fetch(nwsUrl, {
    headers: { 'User-Agent': 'StormBuddyMapApp (contact@example.com)' }
  })
    .then(res => res.json())
    .then(data => {
      L.geoJSON(data, {
        filter: function (feature) {
          const event = feature.properties.event || '';
          return event.includes('Tornado Warning') || event.includes('Tornado Watch');
        },
        style: function (feature) {
          const event = feature.properties.event || '';
          let color = '#d62728'; // Red for Warning
          if (event.includes('Tornado Watch')) {
            color = '#f1c40f'; // Yellow for Watch
          }
          return { color: color, weight: 2, fillOpacity: 0.35 };
        },
        onEachFeature: function (feature, layer) {
          const props = feature.properties;
          layer.bindPopup(
            `<b>${props.event}</b><br>` +
            `<b>Headline:</b> ${props.headline || 'N/A'}<br>` +
            `<b>Severity:</b> ${props.severity}<br>` +
            `<b>Expires:</b> ${new Date(props.expires).toLocaleTimeString()}`
          );
        }
      }).addTo(map);
    })
    .catch(err => console.error('Error fetching NWS alerts:', err));
}

loadNWSAlerts();

// ==========================================
// FEATURE 4: Destination-Only Click Logic
// ==========================================
map.on('click', function (e) {
  if (!isLiveGpsActive || !startPoint) {
    alert("Please turn on Live GPS Tracking first so your route can start from your current location.");
    return;
  }

  const lat = e.latlng.lat;
  const lng = e.latlng.lng;

  if (!endMarker) {
    endMarker = L.marker([lat, lng]).addTo(map).bindPopup("<b>Destination</b>");
  } else {
    endMarker.setLatLng([lat, lng]);
  }

  fetchRoute(startPoint, [lng, lat]);
});

function fetchRoute(start, end) {
  const url = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${apiKey}&start=${start.join(',')}&end=${end.join(',')}`;

  fetch(url)
    .then(res => {
      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      return res.json();
    })
    .then(data => {
      if (routeLayer) map.removeLayer(routeLayer);

      routeLayer = L.geoJSON(data, {
        style: { color: '#00ffff', weight: 6, opacity: 0.9 }
      }).addTo(map);

      const routeData = data.features[0];
      const summary = routeData.properties.summary;
      const miles = (summary.distance * 0.000621371).toFixed(1);
      const totalMinutes = Math.round(summary.duration / 60);
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      const timeString = hours > 0 ? `${hours}h ${mins}m` : `${mins} mins`;

      endMarker.bindPopup(`<b>Destination</b><br>Distance: ${miles} miles<br>Est. Time: ${timeString}`).openPopup();
      map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });

      displayDirections(routeData.properties.segments[0].steps, miles, timeString);
    })
    .catch(err => console.error('Error fetching route:', err));
}

function displayDirections(steps, totalMiles, totalTime) {
  const summaryEl = document.getElementById('summary');
  const listEl = document.getElementById('instructions-list');

  summaryEl.innerHTML = `Total: <b>${totalMiles} mi</b> (${totalTime})`;
  listEl.innerHTML = '';

  steps.forEach(step => {
    const stepMiles = (step.distance * 0.000621371).toFixed(2);
    const li = document.createElement('li');
    li.innerHTML = `${step.instruction} <span style="color: #777;">(${stepMiles} mi)</span>`;
    listEl.appendChild(li);
  });
}

function resetAll() {
  if (startMarker) map.removeLayer(startMarker);
  if (endMarker) map.removeLayer(endMarker);
  if (routeLayer) map.removeLayer(routeLayer);

  startPoint = null;
  startMarker = null;
  endMarker = null;
  routeLayer = null;

  document.getElementById('summary').innerText = 'Turn on Live GPS to select a destination.';
  document.getElementById('instructions-list').innerHTML = '';
}