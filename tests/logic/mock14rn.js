export const Platform = { OS: 'android', Version: 34 };
const RNFS = { DocumentDirectoryPath: '/d', MainBundlePath: '/b', exists: async () => true, mkdir: async () => {}, readFile: async () => 'x', writeFile: async () => {}, unlink: async () => {}, copyFileAssets: async () => {} };
export default RNFS;
export const getLastUpdateTime = async () => 1;
