// ══════════════════════════════════════════════════════
// go() — every screen-to-screen navigation in the app goes through here.
// (FIFTY-FOURTH follow-up: React Navigation 6 -> 7, required by
// react-native-screens 4 on React Native 0.81.)
//
// React Navigation 7 changed navigate() in two ways this app relied on:
//
// 1. navigate('x') used to go BACK to 'x' when it was already in the stack
//    (e.g. Session Detail -> 'sessionHistory', Summary -> Home with
//    Recording still mounted underneath). v7 pushes a second copy instead,
//    leaving old screens — including a still-mounted Recording screen with
//    keep-awake and audio — under it. `{ pop: true }` restores the v6
//    behaviour: go back to it if it exists, otherwise push it.
// 2. navigate('home') from a root-stack screen used to reach the tab inside
//    'mainTabs'. v7 no longer looks inside nested navigators by name, so a
//    tab is reached as navigate('mainTabs', { screen: tab }).
//
// So go(navigation, name, params) behaves exactly like v6's
// navigation.navigate(name, params) did, for root-stack screens and tabs.
// ══════════════════════════════════════════════════════

export const TAB_SCREENS = ['home', 'analytics', 'learn', 'settings'];

export function go(navigation, name, params) {
  if (TAB_SCREENS.includes(name)) {
    navigation.navigate('mainTabs', params === undefined ? { screen: name } : { screen: name, params }, { pop: true });
    return;
  }
  navigation.navigate(name, params, { pop: true });
}
