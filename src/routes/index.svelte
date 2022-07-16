<script lang="ts">
	import { AppShell, Navbar, Header, ShellSection } from '@svelteuidev/core';
</script>

<AppShell>
	<Header slot="header">
		<ShellSection>First section</ShellSection>
		<ShellSection grow>Grow section</ShellSection>
		<ShellSection>Last section</ShellSection>
	</Header>

	<Navbar>
		Nav bar
	</Navbar>

	<slot>This is the main content</slot>
</AppShell>
