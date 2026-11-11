// SoftwareApplication structured data for search engines and AI assistants.
// Landing.astro adds the per-language url, description and featureList from src/i18n.
export const software = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Doko",
  "url": "https://doko.lt/",
  "image": "https://doko.lt/og.png",
  "applicationCategory": "UtilitiesApplication",
  "operatingSystem": "Windows 10, Windows 11, macOS 12 or later, Linux",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "isAccessibleForFree": true,
  "license": "https://opensource.org/licenses/MIT",
  "downloadUrl": "https://github.com/roqusanalytics/doko/releases/latest",
  "sameAs": [
    "https://github.com/roqusanalytics/doko"
  ]
};
