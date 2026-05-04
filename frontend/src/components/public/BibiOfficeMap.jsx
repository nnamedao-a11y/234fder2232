/**
 * BIBI Cars — Office locations on real Google Maps
 * Uses Google Maps embed with coordinate `q=` so the marker shows
 * a clean pin (no auto info panel that overlaps our UI).
 */

import React, { useState } from 'react';
import './BibiOfficeMap.css';

const OFFICES = [
  {
    id: 'dragalevtsi',
    label: 'Dragalevtsi',
    name: 'BIBI Cars — Dragalevtsi',
    address: 'Vitosha Blvd. No. 230, Dragalevtsi, Sofia',
    coords: [42.63810, 23.30240],
    // Coordinate-only query → red pin without info panel
    embedSrc:
      'https://maps.google.com/maps?q=42.63810,23.30240&t=m&z=13&hl=en&ie=UTF8&iwloc=B&output=embed',
    directionsUrl:
      'https://www.google.com/maps/dir/?api=1&destination=42.63810,23.30240',
  },
  {
    id: 'bulgaria-blvd',
    label: 'Bulgaria Blvd.',
    name: 'BIBI Cars — Bulgaria Blvd.',
    address: 'Bulgaria Blvd. No. 81, Sofia',
    coords: [42.67385, 23.29645],
    embedSrc:
      'https://maps.google.com/maps?q=42.67385,23.29645&t=m&z=13&hl=en&ie=UTF8&iwloc=B&output=embed',
    directionsUrl:
      'https://www.google.com/maps/dir/?api=1&destination=42.67385,23.29645',
  },
];

export default function BibiOfficeMap() {
  const [activeId, setActiveId] = useState(OFFICES[0].id);
  const active = OFFICES.find((o) => o.id === activeId) || OFFICES[0];

  return (
    <div className="bibi-office-map" data-testid="bibi-office-map">
      {/* Tabs — TOP-RIGHT (avoids Google's auto info panel which appears top-left) */}
      <div className="bibi-office-map__tabs" role="tablist">
        {OFFICES.map((office) => (
          <button
            key={office.id}
            type="button"
            role="tab"
            aria-selected={office.id === activeId}
            data-active={office.id === activeId}
            className="bibi-office-map__tab"
            onClick={() => setActiveId(office.id)}
            data-testid={`map-tab-${office.id}`}
          >
            {office.label}
          </button>
        ))}
      </div>

      {/* Real Google Maps iframe */}
      <iframe
        key={active.id}
        title={active.name}
        src={active.embedSrc}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        className="bibi-office-map__iframe"
        allowFullScreen
        data-testid="map-iframe"
      />

      {/* Directions CTA — BOTTOM-LEFT (avoids native Google chevron at bottom-right) */}
      <a
        href={active.directionsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="bibi-office-map__cta"
        data-testid="map-directions-cta"
      >
        Get directions →
      </a>
    </div>
  );
}
