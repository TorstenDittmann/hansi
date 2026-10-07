// Runs inside each review sandbox: bridges 127.0.0.1:3128, where HTTP(S)_PROXY points, to the
// egress proxy's unix socket, the sandbox's only way out.
import net from 'node:net';

net
	.createServer((client) => {
		const upstream = net.connect('/run/hansi/proxy.sock');
		client.pipe(upstream).pipe(client);
		upstream.on('error', () => client.destroy());
		client.on('error', () => upstream.destroy());
	})
	.listen(3128, '127.0.0.1');
