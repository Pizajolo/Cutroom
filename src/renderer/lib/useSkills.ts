import { api } from './api';
import { createLiveResource } from './liveResource';

const skills = createLiveResource(() => api.invoke('skills.list', {}), (receive) => api.on('skills.changed', receive), 'Video types could not be loaded.');
export const useSkills = skills.useResource;
