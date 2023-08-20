import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {View, Text, ActivityIndicator, StyleSheet} from 'react-native';
import PropTypes from 'prop-types';
import {WebView} from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import {Camera} from 'expo-camera';

/**
 * @param {String} appID Your dojah application ID, go to your dashboard at https://app.dojah.io/dashboard to retrieve it
 * @param {String} publicKey Your dojah public key, go to your dashboard at https://app.dojah.io/dashboard to retrieve it
 * @param {String} type The dojah widget type to load, go to your dashboard at https://app.dojah.io/dashboard to configure it
 * @param {func}   response callback called when a message is available:
 *                  first parameter is type of message: one of loading, begin, success, error, and close
 *                  second paramater is the data,
 * @param {Object} config These are the configuration options available to you possible options are:
 *                  {debug: BOOL, otp: BOOL, selfie: BOOL}
 *                  NOTE: The otp and selfie options are only
 *                available to the `verification` widget
 * @param {Object} userData Pass in the user's data in the following keys: `first_name` for the first name,
 *                  `last_name` for the last name and `dob` for the date of birth
 * @param {Object} metadata Pass in any data you choose to tag the response when passed to you, this will be
 *                   returned to you in the `kyc_widget` webhook or passed as a parameter to the onSuccess function
 * @param {StyleProp} outerContainerStyle The style of the outermost view
 * @param {StyleProp} outerContainerStyle The style of the outermost view
 * @param {StyleProp} style The style of the middle view
 * @param {StyleProp} innerContainerStyle The style of the innermost view
 */
const Dojah = ({
  appID,
  publicKey,
  type,
  response,
  config,
  userData,
  metadata,
  outerContainerStyle,
  style,
  innerContainerStyle,
}) => {
  const {uri, defaultStyle, injectJavaScript} = Dojah.config;

  // State is undefined for not respoded,
  // null for never requested, true for approved and false for denied
  const [granted, setGranted] = useState({
    location: undefined,
    camera: undefined,
  });
  const [location, setLocation] = useState(null);

  const pages = useMemo(
    () => (!config.pages ? [] : config.pages.map((page) => page.page)),
    [config.pages],
  );

  const needsCamera = useMemo(
    () =>
      ['liveness', 'verification'].includes(type) ||
      pages.includes('selfie') ||
      pages.includes('id') ||
      pages.includes('face-id'),
    [pages, type],
  );

  const needsLocation = useMemo(() => {
    return (
      config?.pages?.some(
        (page) =>
          page.page === 'address' &&
          (typeof page.config?.verification === 'undefined' ||
            page.config?.verification === true),
      ) ?? false
    );
  }, [config.pages]);

  const permissionsNeeded = useMemo(() => needsCamera || needsLocation, [
    needsCamera,
    needsLocation,
  ]);

  useEffect(() => {
    if (permissionsNeeded) {
      requestPermission();
    }
    return () => response('close');
  }, [
    permissionsNeeded,
    requestPermission,
    config.pages,
    type,
    needsCamera,
    needsLocation,
    response,
  ]);

  const log = useCallback(
    (...args) => {
      config.debug && console.log(...args);
    },
    [config.debug],
  );

  const getCurrentPosition = useCallback(async () => {
    try {
      const loc = await Location.getCurrentPositionAsync();
      log('GeoLocation:', loc);
      setLocation(loc);
    } catch (error) {
      log('GeoLocation Error:', error);
      setGranted((state) => ({...state, location: false}));
    }
  }, [log]);

  const requestPermission = useCallback(async () => {
    if (needsCamera) {
      const {status} = await Camera.requestCameraPermissionsAsync();
      setGranted((state) => ({...state, camera: status === 'granted'}));
    }

    if (needsLocation) {
      let {status} = await Location.requestForegroundPermissionsAsync();
      setGranted((state) => ({...state, location: status === 'granted'}));

      if (status === 'granted') {
        getCurrentPosition();
      }
    }
  }, [getCurrentPosition, needsCamera, needsLocation]);

  if (permissionsNeeded) {
    if (
      (needsLocation && granted.location === undefined) ||
      (needsCamera && granted.camera === undefined)
    ) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3977de" />
        </View>
      );
    }

    if (
      (needsLocation && !granted.location) ||
      (needsCamera && !granted.camera)
    ) {
      return (
        <View style={styles.center}>
          <Text style={styles.text}>
            You need to grant all necessary permissions. You denied the the
            following permissions:{' '}
            {Object.keys(granted)
              .map((permission) => (!granted[permission] ? permission : null))
              .filter((permission) => !!permission)
              .join(', ')}
          </Text>
        </View>
      );
    }
  }

  return (
    <View style={[defaultStyle, outerContainerStyle]}>
      <WebView
        originWhiteList={['*']}
        source={{
          baseUrl: 'https://widget.dojah.io',
          html: `
            <html>
              <head>
                <script type="application/javascript" src="${uri}"></script>
                <meta name="viewport" content="width=device-width">
              </head>
              <body></body>
            </html>
          `,
        }}
        style={style}
        containerStyle={innerContainerStyle}
        onMessage={async (e) => {
          const data = JSON.parse(e.nativeEvent.data);
          if (data.type === 'success') {
            const widgetData = data.data.data;

            await AsyncStorage.setItem(
              '@Dojah:SESSION_ID',
              `${data.data.verificationId}`,
            );

            try {
              if (widgetData.address) {
                const addressLocation =
                  widgetData.address.data.location.addressLocation;
                await AsyncStorage.setItem(
                  '@Dojah:LATITUDE',
                  addressLocation.latitude,
                );
                await AsyncStorage.setItem(
                  '@Dojah:LONGITUDE',
                  addressLocation.longitude,
                );
              }
            } catch {}
          }

          response(data.type, data);
        }}
        injectedJavaScript={injectJavaScript(
          appID,
          publicKey,
          type,
          config,
          userData,
          metadata,
          location,
        )}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly={true}
        javaScriptEnabled={true}
        scalesPageToFit={true}
        cacheEnabled={false}
        mediaPlaybackRequiresUserAction={false}
        useWebkit={true}
        startInLoadingState={true}
        androidLayerType="hardware"
        allowsInlineMediaPlayback={needsCamera}
        geolocationEnabled={needsLocation}
      />
    </View>
  );
};

Dojah.hydrate = async (appId, pKey) => {
  const {coords} = await Location.getCurrentPositionAsync();
  const session = await AsyncStorage.getItem('@Dojah:SESSION_ID');
  if (!session) {
    return;
  }

  const addressLocation = {
    latitude: await AsyncStorage.getItem('@Dojah:LATITUDE'),
    longitude: await AsyncStorage.getItem('@Dojah:LONGITUDE'),
  };
  const userLocation = {
    ...coords,
    latitude: coords.latitude,
    longitude: coords.longitude,
  };

  try {
    // Submit the position
    await fetch('https://kyc.dojah.io/address', {
      method: 'POST',
      body: JSON.stringify({
        location: userLocation,
        baseLocation: addressLocation,
        background: true,
        appId,
        pKey,
        session,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (e) {
    console.warn('Hydration Failed', e);
  }
};

Dojah.config = {
  uri: 'https://widget.dojah.io/widget.js',
  defaultStyle: {
    width: '100%',
    height: '100%',
    backgroundColor: 'red',
  },
  injectJavaScript: function (
    appID,
    publicKey,
    type,
    config,
    userData,
    metadata,
    location,
  ) {
    return `
      const options = {
        app_id: "${appID}",
        p_key: "${publicKey}",
        type: "${type}",
        config: ${config ? JSON.stringify(config) : null},
        user_data: ${userData ? JSON.stringify(userData) : null},
        metadata: ${metadata ? JSON.stringify(metadata) : null},
        __location: ${location ? JSON.stringify(location) : null},
        onSuccess: function (response) {
          window.ReactNativeWebView.postMessage(JSON.stringify({type: 'success', data: response}));
        },
        onError: function (err) {
          window.ReactNativeWebView.postMessage(JSON.stringify({type: 'error', data: err}));
        },
        onClose: function (err) {
          window.ReactNativeWebView.postMessage(JSON.stringify({type: 'close', data: err}));
        }
      };

      const connect = new window.Connect(options);
      connect.setup();
      connect.open();
      window.ReactNativeWebView.postMessage(JSON.stringify({type: 'loading'}));
      document.getElementsByTagName('iframe')[0].onload = function() {
        window.ReactNativeWebView.postMessage(JSON.stringify({type: 'begin'}));
      };
      true;
    `;
  },
};

const styles = StyleSheet.create({
  center: {
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    width: '80%',
    height: '80%',
  },
  text: {
    color: 'black',
    textAlign: 'center',
    fontSize: 13,
  },
});

Dojah.propTypes = {
  appID: PropTypes.string.isRequired,
  publicKey: PropTypes.string.isRequired,
  type: PropTypes.string.isRequired,
  response: PropTypes.func.isRequired,
};

export default Dojah;
