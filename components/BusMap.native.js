import React, { useRef, useEffect } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

export default function BusMap({
  style,
  currentLocation,
  stops = [],
  nextStopIndex = 0,
  polylineCoords = [],
  mapDarkStyle,
}) {
  const webviewRef = useRef(null);

  // We use Leaflet via CDN in a WebView to completely bypass Google Play Services.
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        body { padding: 0; margin: 0; background-color: #1a1a1a; }
        #map { width: 100vw; height: 100vh; }
        .bus-marker {
          background-color: #FFD700;
          border: 2px solid #FFF;
          border-radius: 50%;
          width: 44px;
          height: 44px;
          display: flex;
          justify-content: center;
          align-items: center;
          box-shadow: 0 0 10px rgba(255, 215, 0, 0.8);
          font-size: 24px;
          line-height: 44px;
          text-align: center;
        }
        .stop-marker {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 2px solid white;
          box-shadow: 0 0 4px rgba(0,0,0,0.5);
        }
        .bus-marker-wrapper {
          transition: transform 1.0s linear !important;
          z-index: 1000 !important;
        }
        .leaflet-container {
          background: #1a1a1a;
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([10.8505, 76.2711], 13);
        
        // CartoDB Dark Matter tiles to match the UI theme
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          maxZoom: 19
        }).addTo(map);

        var busMarker = null;
        var polyline = null;
        var stopMarkers = [];

        function updateMap(data) {
          // Update Route
          if (data.polylineCoords && data.polylineCoords.length > 0) {
            if (polyline) map.removeLayer(polyline);
            var latlngs = data.polylineCoords.map(function(c) { return [c.latitude, c.longitude]; });
            polyline = L.polyline(latlngs, {color: '#4D8EFF', weight: 5, opacity: 0.8}).addTo(map);
          }

          // Update Stops
          if (data.stops) {
            stopMarkers.forEach(function(m) { map.removeLayer(m); });
            stopMarkers = [];
            data.stops.forEach(function(stop, i) {
              if (stop.coordinate) {
                var isNext = (i === data.nextStopIndex);
                var isPast = (i < data.nextStopIndex);
                var color = isNext ? '#FFD700' : (isPast ? '#555555' : '#4D8EFF');
                
                var icon = L.divIcon({
                  className: '',
                  html: '<div class="stop-marker" style="background-color: ' + color + '"></div>',
                  iconSize: [16, 16],
                  iconAnchor: [8, 8]
                });
                var m = L.marker([stop.coordinate.latitude, stop.coordinate.longitude], {icon: icon}).addTo(map);
                stopMarkers.push(m);
              }
            });
          }

          // Update Bus Location
          if (data.currentLocation) {
            var latlng = [data.currentLocation.latitude, data.currentLocation.longitude];
            if (!busMarker) {
              var busIcon = L.divIcon({
                className: 'bus-marker-wrapper',
                html: '<div class="bus-marker">🚌</div>',
                iconSize: [44, 44],
                iconAnchor: [22, 22]
              });
              busMarker = L.marker(latlng, {icon: busIcon}).addTo(map);
              map.setView(latlng, 15);
            } else {
              var dist = map.distance(busMarker.getLatLng(), latlng);
              // Only animate if moved more than 3 meters to prevent stationary GPS noise jitter
              if (dist > 3) {
                busMarker.setLatLng(latlng);
                map.panTo(latlng, { animate: true, duration: 1.0, easeLinearity: 1 });
              }
            }
          }
        }

        // Listen for messages from React Native
        document.addEventListener("message", function(event) {
          try {
            updateMap(JSON.parse(event.data));
          } catch(e) {}
        });
        window.addEventListener("message", function(event) {
          try {
            updateMap(JSON.parse(event.data));
          } catch(e) {}
        });
      </script>
    </body>
    </html>
  `;

  // Send new props to the WebView whenever they change
  useEffect(() => {
    if (webviewRef.current) {
      webviewRef.current.postMessage(JSON.stringify({
        currentLocation,
        stops,
        nextStopIndex,
        polylineCoords
      }));
    }
  }, [currentLocation, stops, nextStopIndex, polylineCoords]);

  return (
    <View style={style || { flex: 1 }}>
      <WebView
        ref={webviewRef}
        source={{ html: htmlContent }}
        style={{ flex: 1, backgroundColor: '#1a1a1a' }}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        originWhitelist={['*']}
        javaScriptEnabled={true}
      />
    </View>
  );
}
