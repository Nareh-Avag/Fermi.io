import React from 'react';
import './MarqueeCards.css'; // Connects the layout styles and animation keyframes

// Import your 4 SVG assets from the assets directory
import Card1 from './assets/card1-asset.svg';
import Card2 from './assets/card2-asset.svg';
import Card3 from './assets/card3-asset.svg';
import Card4 from './assets/card4-asset.svg';

const MarqueeCards = () => {
  const cards = [
    { id: 'fermi-1', src: Card1, alt: 'Fermi problem card example 1' },
    { id: 'fermi-2', src: Card2, alt: 'Fermi problem card example 2' },
    { id: 'fermi-3', src: Card3, alt: 'Fermi problem card example 3' },
    { id: 'fermi-4', src: Card4, alt: 'Fermi problem card example 4' },
  ];

  // Duplicate the array once to create a perfectly seamless horizontal loop sequence
  const infiniteLoopCards = [...cards, ...cards];

  return (
    <div className="marquee-container" aria-hidden="true">
      <div className="marquee-track">
        {infiniteLoopCards.map((card, index) => (
          <div className="marquee-card-wrapper" key={`${card.id}-${index}`}>
            <img 
              src={card.src} 
              alt={card.alt} 
              className="marquee-svg-card"
              loading="eager"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default MarqueeCards;