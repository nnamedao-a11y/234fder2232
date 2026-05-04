/**
 * VinSearchBar (legacy shim)
 * Kept for backward compatibility with old imports — delegates to the new
 * `VinSearchAutocomplete` so the same dropdown UX appears everywhere
 * (header, hero, home page, etc.).
 */
import React from 'react';
import VinSearchAutocomplete from './VinSearchAutocomplete';

export const VinSearchBar = ({
  width = 278,
  className = '',
  testId = 'global-vin-search',
  placeholder,
}) => (
  <VinSearchAutocomplete
    width={width}
    className={className}
    testId={testId}
    placeholder={placeholder || 'SEARCH BY VIN OR LOT NUMBER'}
  />
);

export default VinSearchBar;
