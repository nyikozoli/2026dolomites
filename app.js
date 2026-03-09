(function () {
  'use strict';

  // ============================
  // CONFIGURATION
  // ============================
  const CONFIG = {
    SPREADSHEET_ID: '1PwjRp80UIcYZlUaswUXdbWW_8I7qhmLRWPInoJPmcJQ',
    SHEET_ATTRACTIONS_URL:
      'https://docs.google.com/spreadsheets/d/1PwjRp80UIcYZlUaswUXdbWW_8I7qhmLRWPInoJPmcJQ/gviz/tq?tqx=out:csv',
    SHEET_STAYS_URL:
      'https://docs.google.com/spreadsheets/d/1PwjRp80UIcYZlUaswUXdbWW_8I7qhmLRWPInoJPmcJQ/gviz/tq?tqx=out:csv&sheet=Szallasok',
    // Paste your Unsplash Access Key here (https://unsplash.com/developers)
    UNSPLASH_ACCESS_KEY: 'ddK-ifsVxRtj1XjWZXWIqN-p5-xgXy4i3TEsOFAiAO0',
    // Paste your deployed Apps Script URL here
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwOdbhxnO80UXzxm1nnPyxkKdWflRbJRI_02Ph4sVKnA1Flo_3zDpUlzHgFBBEghPU/exec',
    MAP_CENTER: [46.55, 12.05],
    MAP_ZOOM: 10,
    IMAGES_PER_PLACE: 3,
    IMAGE_CACHE_KEY: 'dolomites_img_cache',
    IMAGE_CACHE_TTL: 24 * 60 * 60 * 1000,
    VOTE_CACHE_KEY: 'dolomites_votes_v2',
    VOTER_KEY: 'dolomites_voter',
  };

  // ============================
  // STATE
  // ============================
  const state = {
    places: [],
    markers: {},
    activeFilter: 'all',
    searchQuery: '',
    highlightedId: null,
    votes: {},
    userVotes: {},
    voterName: localStorage.getItem(CONFIG.VOTER_KEY) || '',
  };

  let map;

  // ============================
  // CSV PARSING
  // ============================
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  function parseCSV(text) {
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return [];
    const headers = parseCSVLine(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const vals = parseCSVLine(line);
      const obj = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = (vals[i] || '').trim();
      });
      return obj;
    });
  }

  async function fetchSheet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    return parseCSV(await res.text());
  }

  // ============================
  // DATA NORMALIZATION
  // ============================
  function parseWKT(wkt) {
    const m = (wkt || '').match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/);
    if (!m) return null;
    return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
  }

  function slugify(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function normalizeAttractions(rows) {
    return rows
      .map((r) => {
        const c = parseWKT(r.WKT || r.wkt);
        if (!c) return null;
        return {
          id: 'a-' + (r.Order || '0') + '-' + slugify(r.Name),
          type: 'attraction',
          order: parseInt(r.Order) || 0,
          name: r.Name || '',
          description: r.Description || '',
          link: r.Link || '',
          lat: c.lat,
          lng: c.lng,
        };
      })
      .filter(Boolean);
  }

  function normalizeStays(rows) {
    return rows
      .map((r, i) => {
        const c = parseWKT(r.WKT || r.wkt);
        if (!c) return null;
        return {
          id: 's-' + (i + 1) + '-' + slugify(r.name || r.Name),
          type: 'stay',
          order: 0,
          name: r.name || r.Name || '',
          description: r.description || r.Description || '',
          link: r.Link || r.link || '',
          lat: c.lat,
          lng: c.lng,
        };
      })
      .filter(Boolean);
  }

  // ============================
  // MAP
  // ============================
  function createIcon(type, highlighted) {
    const color = type === 'attraction' ? '#0d9488' : '#ea580c';
    const size = highlighted ? 36 : 28;
    const anchor = highlighted ? 18 : 14;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(size * 1.43)}" viewBox="0 0 28 40">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.27 21.73 0 14 0z" fill="${color}" stroke="#fff" stroke-width="2"/>
      <circle cx="14" cy="14" r="6" fill="#fff"/>
    </svg>`;
    return L.divIcon({
      html: svg,
      className: 'custom-marker' + (highlighted ? ' marker-highlighted' : ''),
      iconSize: [size, Math.round(size * 1.43)],
      iconAnchor: [anchor, Math.round(size * 1.43)],
      popupAnchor: [0, -Math.round(size * 1.43)],
    });
  }

  function initMap() {
    map = L.map('map', { scrollWheelZoom: true }).setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
  }

  function addMarkers(places) {
    places.forEach((p) => {
      const marker = L.marker([p.lat, p.lng], { icon: createIcon(p.type, false) }).addTo(map);
      marker.bindPopup(
        `<strong>${esc(p.name)}</strong>` +
          (p.description ? `<p>${esc(p.description.substring(0, 120))}${p.description.length > 120 ? '...' : ''}</p>` : '') +
          (p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">More info &rarr;</a>` : '')
      );
      marker.on('click', () => highlightPlace(p.id, 'map'));
      state.markers[p.id] = marker;
    });
    fitMapBounds();
  }

  function fitMapBounds() {
    const visible = state.places.filter(filterPlace);
    const markers = visible.map((p) => state.markers[p.id]).filter(Boolean);
    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }
  }

  function updateMapMarkers() {
    state.places.forEach((p) => {
      const marker = state.markers[p.id];
      if (!marker) return;
      if (filterPlace(p)) {
        if (!map.hasLayer(marker)) marker.addTo(map);
      } else {
        if (map.hasLayer(marker)) map.removeLayer(marker);
      }
    });
  }

  // ============================
  // CARDS
  // ============================
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function renderCards() {
    const grid = document.getElementById('places-grid');
    const noResults = document.getElementById('no-results');
    grid.innerHTML = '';

    const filtered = state.places.filter(filterPlace);
    noResults.classList.toggle('hidden', filtered.length > 0);

    filtered.forEach((p, i) => {
      const votes = state.votes[p.id] || { up: 0, down: 0 };
      const uv = state.userVotes[p.id] || '';

      const card = document.createElement('div');
      card.className = 'place-card';
      card.dataset.id = p.id;
      card.dataset.type = p.type;
      card.style.transitionDelay = `${Math.min(i * 40, 400)}ms`;

      card.innerHTML = `
        ${p.type === 'attraction' ? `<div class="card-images" data-id="${p.id}">
          <div class="image-carousel">
            <div class="carousel-track">
              <div class="image-placeholder">Loading photos...</div>
            </div>
          </div>
        </div>` : ''}
        <div class="card-body">
          <span class="card-badge ${p.type}">${p.type === 'attraction' ? '&#9968; Attraction' : '&#127968; Stay'}</span>
          ${p.order ? `<span class="card-order">#${p.order}</span>` : ''}
          <h3 class="card-title">${esc(p.name)}</h3>
          <p class="card-description">${esc(p.description)}</p>
          <div class="card-footer">
            ${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener" class="card-link" onclick="event.stopPropagation()">View details &rarr;</a>` : '<span></span>'}
            <div class="vote-buttons">
              <button class="vote-btn upvote${uv === 'up' ? ' active' : ''}" data-id="${p.id}" data-vote="up">
                <span class="vote-icon">&#9650;</span> <span class="vote-count">${votes.up}</span>
              </button>
              <button class="vote-btn downvote${uv === 'down' ? ' active' : ''}" data-id="${p.id}" data-vote="down">
                <span class="vote-icon">&#9660;</span> <span class="vote-count">${votes.down}</span>
              </button>
            </div>
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.vote-btn') || e.target.closest('.card-link')) return;
        highlightPlace(p.id, 'card');
      });

      grid.appendChild(card);
    });

    observeCards();
    // Stagger image loads — only attractions get photos (stays don't need them)
    const attractions = filtered.filter((p) => p.type === 'attraction');
    attractions.forEach((p, i) => setTimeout(() => loadImages(p), i * 300));
  }

  // ============================
  // BIDIRECTIONAL HIGHLIGHT
  // ============================
  function highlightPlace(id, source) {
    // Clear previous
    if (state.highlightedId && state.highlightedId !== id) {
      const prev = document.querySelector(`.place-card[data-id="${state.highlightedId}"]`);
      if (prev) prev.classList.remove('highlighted');
      const pm = state.markers[state.highlightedId];
      if (pm) {
        const place = state.places.find((p) => p.id === state.highlightedId);
        if (place) pm.setIcon(createIcon(place.type, false));
      }
    }

    state.highlightedId = id;

    // Highlight card
    const card = document.querySelector(`.place-card[data-id="${id}"]`);
    if (card) {
      card.classList.add('highlighted');
      if (source === 'map') {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    // Highlight marker
    const marker = state.markers[id];
    const place = state.places.find((p) => p.id === id);
    if (marker && place) {
      marker.setIcon(createIcon(place.type, true));
      if (source === 'card') {
        map.flyTo(marker.getLatLng(), 13, { duration: 0.8 });
        marker.openPopup();
      }
    }
  }

  // ============================
  // FILTERING
  // ============================
  function filterPlace(p) {
    const typeMatch = state.activeFilter === 'all' || state.activeFilter === p.type;
    const q = state.searchQuery;
    const searchMatch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q);
    return typeMatch && searchMatch;
  }

  function setupFilters() {
    document.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelector('.filter-btn.active').classList.remove('active');
        btn.classList.add('active');
        state.activeFilter = btn.dataset.filter;
        renderCards();
        updateMapMarkers();
      });
    });

    let timer;
    document.getElementById('search-input').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.searchQuery = e.target.value.toLowerCase().trim();
        renderCards();
        updateMapMarkers();
      }, 200);
    });
  }

  // ============================
  // SCROLL ANIMATIONS
  // ============================
  function observeCards() {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('visible');
            observer.unobserve(e.target);
          }
        });
      },
      { threshold: 0.05 }
    );
    document.querySelectorAll('.place-card:not(.visible)').forEach((c) => observer.observe(c));
  }

  // ============================
  // IMAGES (UNSPLASH)
  // ============================
  function getImageCache() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.IMAGE_CACHE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function setImageCache(cache) {
    try {
      localStorage.setItem(CONFIG.IMAGE_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // localStorage full, ignore
    }
  }

  let rateLimited = false;

  async function searchUnsplash(query) {
    if (rateLimited) return null; // null = rate limited, [] = no results
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${CONFIG.IMAGES_PER_PLACE}&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${CONFIG.UNSPLASH_ACCESS_KEY}` } }
    );
    if (res.status === 403 || res.status === 429) {
      rateLimited = true;
      console.warn('Unsplash rate limit reached — using placeholders for remaining cards.');
      return null;
    }
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((p) => ({
      url: p.urls.small,
      alt: p.alt_description || query,
      credit: p.user.name,
      creditUrl: p.user.links.html,
    }));
  }

  // Simplify place name for better Unsplash search results
  function simplifyQuery(name) {
    return name
      .replace(/\s*[-–—\/]\s*/g, ' ')      // "Lago di Braies / Pragser Wildsee" → separate words
      .replace(/\b(trailhead|car park|parking|circuit|viewpoint|cable car|valley station|upper station|panorama|evening walk|photo stop|easy meadow loop|center|area)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function loadImages(place) {
    const cache = getImageCache();
    if (cache[place.id] && Date.now() - cache[place.id].ts < CONFIG.IMAGE_CACHE_TTL) {
      renderCarousel(place.id, cache[place.id].imgs);
      return;
    }

    if (!CONFIG.UNSPLASH_ACCESS_KEY || rateLimited) {
      renderCarousel(place.id, []);
      return;
    }

    // Single optimized query — stay under rate limit (31 attractions ≤ 50 req/hr)
    const simple = simplifyQuery(place.name);
    const query = simple + ' Dolomites Italy';

    let imgs = await searchUnsplash(query);
    if (imgs === null) { renderCarousel(place.id, []); return; } // rate limited

    // One fallback with shorter query if no results
    if (imgs.length === 0 && !rateLimited) {
      imgs = await searchUnsplash(simple);
      if (imgs === null) { renderCarousel(place.id, []); return; }
    }

    cache[place.id] = { imgs, ts: Date.now() };
    setImageCache(cache);
    renderCarousel(place.id, imgs);
  }

  function renderCarousel(placeId, images) {
    const container = document.querySelector(`.card-images[data-id="${placeId}"]`);
    if (!container) return;

    if (!images || images.length === 0) {
      container.innerHTML = `<div class="image-fallback"><span>&#9968;</span></div>`;
      return;
    }

    const slides = images
      .map(
        (img, i) => `
      <div class="carousel-slide${i === 0 ? ' active' : ''}">
        <img src="${esc(img.url)}" alt="${esc(img.alt)}" loading="lazy">
        <span class="image-credit">
          <a href="${esc(img.creditUrl)}?utm_source=dolomites2026&utm_medium=referral" target="_blank" rel="noopener">${esc(img.credit)}</a>
        </span>
      </div>`
      )
      .join('');

    const dots = images
      .map((_, i) => `<button class="carousel-dot${i === 0 ? ' active' : ''}" data-index="${i}"></button>`)
      .join('');

    container.innerHTML = `
      <div class="image-carousel">
        <div class="carousel-track">${slides}</div>
        ${images.length > 1 ? `<div class="carousel-dots">${dots}</div>
        <button class="carousel-prev" onclick="event.stopPropagation()">&lsaquo;</button>
        <button class="carousel-next" onclick="event.stopPropagation()">&rsaquo;</button>` : ''}
      </div>`;

    if (images.length > 1) setupCarouselNav(container);
  }

  function setupCarouselNav(container) {
    let idx = 0;
    const slides = container.querySelectorAll('.carousel-slide');
    const dots = container.querySelectorAll('.carousel-dot');

    function goTo(n) {
      slides[idx].classList.remove('active');
      dots[idx]?.classList.remove('active');
      idx = ((n % slides.length) + slides.length) % slides.length;
      slides[idx].classList.add('active');
      dots[idx]?.classList.add('active');
    }

    container.querySelector('.carousel-prev')?.addEventListener('click', (e) => {
      e.stopPropagation();
      goTo(idx - 1);
    });
    container.querySelector('.carousel-next')?.addEventListener('click', (e) => {
      e.stopPropagation();
      goTo(idx + 1);
    });
    dots.forEach((d, i) =>
      d.addEventListener('click', (e) => {
        e.stopPropagation();
        goTo(i);
      })
    );
  }

  // ============================
  // VOTING
  // ============================
  function loadCachedVotes() {
    try {
      const c = JSON.parse(localStorage.getItem(CONFIG.VOTE_CACHE_KEY) || '{}');
      state.votes = c.votes || {};
      state.userVotes = c.userVotes || {};
    } catch {
      state.votes = {};
      state.userVotes = {};
    }
  }

  function saveCachedVotes() {
    localStorage.setItem(
      CONFIG.VOTE_CACHE_KEY,
      JSON.stringify({ votes: state.votes, userVotes: state.userVotes })
    );
  }

  async function fetchVotes() {
    if (!CONFIG.APPS_SCRIPT_URL) return;

    // Try fetch first, fall back to JSONP if CORS blocks the redirect
    try {
      const res = await fetch(CONFIG.APPS_SCRIPT_URL, { redirect: 'follow' });
      const data = await res.json();
      if (data.status === 'ok' && data.votes) {
        state.votes = data.votes;
        state.places.forEach((p) => updateVoteUI(p.id));
        saveCachedVotes();
        return;
      }
    } catch {
      // CORS redirect blocked — fall back to JSONP
    }

    try {
      const data = await new Promise((resolve, reject) => {
        const cb = '_voteCb' + Date.now();
        const script = document.createElement('script');
        window[cb] = (d) => { delete window[cb]; script.remove(); resolve(d); };
        script.onerror = () => { delete window[cb]; script.remove(); reject(new Error('JSONP failed')); };
        script.src = CONFIG.APPS_SCRIPT_URL + '?callback=' + cb;
        document.head.appendChild(script);
        setTimeout(() => { if (window[cb]) { delete window[cb]; script.remove(); reject(new Error('JSONP timeout')); } }, 8000);
      });
      if (data.status === 'ok' && data.votes) {
        state.votes = data.votes;
        state.places.forEach((p) => updateVoteUI(p.id));
        saveCachedVotes();
      }
    } catch (err) {
      console.warn(
        'Vote fetch failed. Make sure your Apps Script is deployed as:\n' +
        '  Execute as: Me\n' +
        '  Who has access: Anyone (not "Anyone with Google account")\n' +
        'Then redeploy and update the URL in app.js CONFIG.APPS_SCRIPT_URL'
      );
    }
  }

  function updateVoteUI(id) {
    const card = document.querySelector(`.place-card[data-id="${id}"]`);
    if (!card) return;
    const v = state.votes[id] || { up: 0, down: 0 };
    const uv = state.userVotes[id] || '';
    const up = card.querySelector('.upvote');
    const down = card.querySelector('.downvote');
    if (up) {
      up.querySelector('.vote-count').textContent = v.up;
      up.classList.toggle('active', uv === 'up');
    }
    if (down) {
      down.querySelector('.vote-count').textContent = v.down;
      down.classList.toggle('active', uv === 'down');
    }
  }

  function ensureVoterName() {
    return new Promise((resolve) => {
      if (state.voterName) return resolve(state.voterName);
      const modal = document.getElementById('voter-modal');
      const input = document.getElementById('voter-name-input');
      const submitBtn = document.getElementById('voter-name-submit');
      const cancelBtn = document.getElementById('voter-name-cancel');
      const backdrop = modal.querySelector('.modal-backdrop');
      modal.classList.remove('hidden');
      input.value = '';
      input.focus();

      function cleanup() {
        modal.classList.add('hidden');
        submitBtn.onclick = null;
        cancelBtn.onclick = null;
        backdrop.onclick = null;
        input.onkeydown = null;
      }

      function submit() {
        const name = input.value.trim();
        if (!name) return;
        state.voterName = name;
        localStorage.setItem(CONFIG.VOTER_KEY, name);
        cleanup();
        resolve(name);
      }

      function cancel() {
        cleanup();
        resolve(null);
      }

      submitBtn.onclick = submit;
      cancelBtn.onclick = cancel;
      backdrop.onclick = cancel;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') cancel();
      };
    });
  }

  const voteCooldowns = {};

  function setupVoteHandlers() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.vote-btn');
      if (!btn) return;
      e.stopPropagation();

      const id = btn.dataset.id;
      const voteType = btn.dataset.vote;

      // Prevent rapid clicks (2 second cooldown per place)
      if (voteCooldowns[id] && Date.now() - voteCooldowns[id] < 2000) return;
      voteCooldowns[id] = Date.now();
      const place = state.places.find((p) => p.id === id);
      if (!place) return;

      const voter = await ensureVoterName();
      if (!voter) return;

      // Toggle
      const prev = state.userVotes[id];
      const next = prev === voteType ? null : voteType;

      if (!state.votes[id]) state.votes[id] = { up: 0, down: 0 };
      if (prev) state.votes[id][prev] = Math.max(0, (state.votes[id][prev] || 0) - 1);
      if (next) state.votes[id][next] = (state.votes[id][next] || 0) + 1;
      state.userVotes[id] = next;

      updateVoteUI(id);
      saveCachedVotes();

      // Animate button press
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 300);

      // Show saving indicator on card footer
      const card = btn.closest('.place-card');
      const footer = card?.querySelector('.card-footer');
      let indicator = card?.querySelector('.vote-indicator');
      if (footer && !indicator) {
        indicator = document.createElement('div');
        indicator.className = 'vote-indicator';
        footer.appendChild(indicator);
      }
      if (indicator) {
        indicator.textContent = next ? '✓ Vote saved' : '✓ Vote removed';
        indicator.classList.add('show');
        setTimeout(() => indicator.classList.remove('show'), 1800);
      }

      // Send to backend via JSONP — sends vote AND returns correct aggregated counts
      const sendVoteType = next || 'none'; // 'none' removes the vote on the server
      if (CONFIG.APPS_SCRIPT_URL) {
        const cbName = '_vs' + Date.now();
        const params = new URLSearchParams({
          action: 'vote',
          placeId: id,
          placeName: place.name,
          voteType: sendVoteType,
          voter,
          callback: cbName,
        });
        const script = document.createElement('script');
        let done = false;
        window[cbName] = (data) => {
          done = true;
          delete window[cbName];
          script.remove();
          // Override local counts with server-aggregated data (correctly deduplicated)
          if (data.status === 'ok' && data.votes) {
            state.votes = data.votes;
            updateVoteUI(id);
            saveCachedVotes();
          }
        };
        script.onerror = () => {
          if (done) return;
          delete window[cbName];
          script.remove();
          // Fallback: image beacon + delayed refresh to correct counts
          const bp = new URLSearchParams({ action: 'vote', placeId: id, placeName: place.name, voteType: sendVoteType, voter });
          new Image().src = CONFIG.APPS_SCRIPT_URL + '?' + bp.toString();
          setTimeout(() => fetchVotes(), 3000);
        };
        script.src = CONFIG.APPS_SCRIPT_URL + '?' + params.toString();
        document.head.appendChild(script);
        // Timeout safety
        setTimeout(() => {
          if (!done && window[cbName]) {
            delete window[cbName];
            script.remove();
          }
        }, 10000);
      }
    });
  }

  // ============================
  // LOADING
  // ============================
  function hideLoading() {
    const el = document.getElementById('loading-overlay');
    el.classList.add('fade-out');
    setTimeout(() => (el.style.display = 'none'), 500);
  }

  // ============================
  // INIT
  // ============================
  async function init() {
    try {
      const [attrRows, stayRows] = await Promise.all([
        fetchSheet(CONFIG.SHEET_ATTRACTIONS_URL),
        fetchSheet(CONFIG.SHEET_STAYS_URL),
      ]);

      state.places = [...normalizeAttractions(attrRows), ...normalizeStays(stayRows)];

      loadCachedVotes();

      initMap();
      addMarkers(state.places);
      renderCards();
      setupFilters();
      setupVoteHandlers();

      hideLoading();

      // Fetch live votes in background
      fetchVotes();
    } catch (err) {
      console.error('Init failed:', err);
      document.getElementById('loading-overlay').innerHTML =
        '<p style="color:#dc2626;padding:24px;">Failed to load data. Make sure the spreadsheet is publicly shared, then refresh.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
