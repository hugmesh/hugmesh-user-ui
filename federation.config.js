// REMOTE bundle config for the User micro-frontend (native-federation remote
// name "user"). The hugmesh.systems host consumes the exposed modules via
// loadRemoteModule({ remoteName: 'user', exposedModule: '<key>' }) and mounts
// the USER_ROUTES at the user role-home — so the remote name and the exposed
// module keys MUST stay unchanged or the host's user views break.
//
// `./routes` is the role-home surface (welcome guide, cards, self-blocks,
// recommend-instance-block). The profile editor is ALSO exposed standalone as
// `./profile` so the host can mount it as a modal (the host shows it as a modal
// later) without pulling the whole route tree.
//
// The shared-deps surface + RxJS skip list live in ./federation-base.js so a
// change to the federation contract lands in one file, consistent with the host
// and every other HugMesh remote (games convention).
const { hugmeshRemote } = require('./federation-base');

module.exports = hugmeshRemote({
  name: 'user',
  exposes: {
    './routes': './src/app/user.routes.ts',
    './profile': './src/app/profile.component.ts',
  },
});
