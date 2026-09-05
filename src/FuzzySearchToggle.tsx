import React, { useState, useCallback } from 'react';
import { toggleFuzzyMode } from './plugin-search-fuzzy';

interface FuzzySearchToggleProps {
  onToggle?: (enabled: boolean) => void;
}

export const FuzzySearchToggle: React.FC<FuzzySearchToggleProps> = ({ onToggle }) => {
  const [enabled, setEnabled] = useState(false);

  const handleToggle = useCallback(() => {
    const newValue = !enabled;
    setEnabled(newValue);
    onToggle?.(newValue);
  }, [enabled, onToggle]);

  return (
    <label className="fuzzy-search-toggle">
      <input
        type="checkbox"
        checked={enabled}
        onChange={handleToggle}
        className="fuzzy-search-checkbox"
      />
      <span className="fuzzy-search-label">Fuzzy</span>
    </label>
  );
};

export default FuzzySearchToggle;
