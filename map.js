import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

const INPUT_BLUEBIKES_JSON_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

const INPUT_TRAFFIC_CSV_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

let timeFilter = -1; 

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

const stationFlow = d3
  .scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]);

mapboxgl.accessToken =
  'pk.eyJ1IjoibGF1cmVudGhhbmh2byIsImEiOiJjbWh5ZzNlOTMwMWtiMmtxYmVwb3c3cDFiIn0.v4pHzhsvG_rntpG3qGVMbQ';

const bikeLanePaint = {
  'line-color': 'hsla(106, 26%, 44%, 1.0)', 
  'line-width': 5,
  'line-opacity': 0.6,
};

const map = new mapboxgl.Map({
  container: 'map', 
  style: 'mapbox://styles/mapbox/streets-v12', 
  center: [-71.09415, 42.36027], 
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); 
  const { x, y } = map.project(point); 
  return { cx: x, cy: y }; 
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLanePaint,
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLanePaint,
  });

  let jsonData;
  try {
    jsonData = await d3.json(INPUT_BLUEBIKES_JSON_URL);
    console.log('Loaded station JSON:', jsonData);
  } catch (error) {
    console.error('Error loading station JSON:', error);
    return; 
  }

  let stations = jsonData.data.stations;

  let trips;
  try {
    trips = await d3.csv(
      INPUT_TRAFFIC_CSV_URL,
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
      },
    );
    console.log('Loaded trips:', trips.length);
  } catch (error) {
    console.error('Error loading trips CSV:', error);
    return;
  }

  stations = computeStationTraffic(stations, trips);
  console.log('Stations with traffic data:', stations);

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  const svg = d3.select('#map').select('svg');

  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name) 
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    })
    .style('--departure-ratio', (d) =>
      stationFlow(d.departures / d.totalTraffic),
    );

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  function filterTripsByTime(allTrips, timeFilterValue) {
    return timeFilterValue === -1
      ? allTrips
      : allTrips.filter((trip) => {
          const startedMinutes = minutesSinceMidnight(trip.started_at);
          const endedMinutes = minutesSinceMidnight(trip.ended_at);

          return (
            Math.abs(startedMinutes - timeFilterValue) <= 60 ||
            Math.abs(endedMinutes - timeFilterValue) <= 60
          );
        });
  }

  function updateScatterPlot(timeFilterValue) {
    if (timeFilterValue === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]);
    }

    const filteredTrips = filterTripsByTime(trips, timeFilterValue);

    const filteredStations = computeStationTraffic(stations, filteredTrips);

    circles
      .data(filteredStations, (d) => d.short_name)
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .each(function (d) {
        d3.select(this)
          .select('title')
          .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
          );
      })
      .style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic),
      );
  }

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = ''; 
      anyTimeLabel.style.display = 'block'; 
    } else {
      selectedTime.textContent = formatTime(timeFilter); 
      anyTimeLabel.style.display = 'none'; 
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
