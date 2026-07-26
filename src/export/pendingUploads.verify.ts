import assert from 'node:assert/strict';
import { hasPendingUpload, PENDING_UPLOAD_EXPORT_MESSAGE } from './pendingUploads';

assert.equal(hasPendingUpload([{ src: '/media/ready.mp4' }, { src: undefined }]), false);
assert.equal(hasPendingUpload([{ src: 'blob:https://app.local/uploading-video' }]), true);
assert.equal(
  PENDING_UPLOAD_EXPORT_MESSAGE,
  'Uno o más videos todavía se están subiendo o procesando. Espera a que terminen antes de exportar.',
);

console.log('pending upload export checks passed');
