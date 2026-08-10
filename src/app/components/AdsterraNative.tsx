import React, { useEffect, useRef } from 'react';

export default function AdsterraNative() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              margin: 0;
              padding: 0;
              background: transparent;
            }
          </style>
        </head>
        <body>
          <div id="container-94108fa6df80ac27633f4422ccd16634"></div>
          <script async="async" data-cfasync="false" src="https://pl30780814.effectivecpmnetwork.com/94108fa6df80ac27633f4422ccd16634/invoke.js"></script>
        </body>
      </html>
    `);
    doc.close();
  }, []);

  return (
    <div style={{ width: '100%', margin: '1.25rem 0' }}>
      <iframe
        ref={iframeRef}
        width="100%"
        height="220"
        frameBorder="0"
        scrolling="no"
        style={{ border: 'none', background: 'transparent' }}
      />
    </div>
  );
}
