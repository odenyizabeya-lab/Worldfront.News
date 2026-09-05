const config = {
  appId: 'news.worldfront.app',
  appName: 'WorldFront.News',
  webDir: 'www',
  android: {
    backgroundColor: '#0b4ea2',
    allowMixedContent: false
  },
  server: {
    // The Android app loads the real, live WorldFront.News platform so all
    // features (search, categories, location, breaking news, accounts) use the
    // exact same backend + database as the website and PWA.
    androidScheme: 'https',
    url: 'https://worldfront.news',
    cleartext: false
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0b4ea2'
    },
    CapacitorHttp: { enabled: true },
    CapacitorCookies: { enabled: true },
    Geolocation: {
      // Location is opt-in (see app's location panel). We never publish exact coords.
      permission: 'access_fine_location'
    }
  }
};

module.exports = config;
