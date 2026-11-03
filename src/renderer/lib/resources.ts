import { api } from './api';
import { createLiveResource } from './liveResource';
const settings = createLiveResource(() => api.invoke('settings.get', {}), (receive) => api.on('settings.changed', receive), 'Settings could not be loaded.');
const jobs = createLiveResource(() => api.invoke('jobs.list', {}), (receive) => api.on('jobs.changed', receive), 'Jobs could not be loaded.');
export const useSettings = settings.useResource;
export const useJobs = jobs.useResource;
