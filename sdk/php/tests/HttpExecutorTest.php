<?php

declare(strict_types=1);

namespace OpenWA\Tests;

use PHPUnit\Framework\TestCase;

class HttpExecutorTest extends TestCase
{
    /**
     * The path is appended to the base URL, so one without a leading "/" could move the
     * host and carry the API key elsewhere. It is refused before anything is sent.
     */
    public function testPathWithoutLeadingSlashIsRefusedBeforeSending(): void
    {
        $backend = new MockBackend();
        $client = $backend->makeClient();
        foreach (['.evil.example/x', '@evil.example/x', 'api/sessions'] as $path) {
            try {
                $client->request('GET', $path);
                $this->fail("Expected InvalidArgumentException for {$path}");
            } catch (\InvalidArgumentException $e) {
                $this->assertStringContainsString('path must begin with "/"', $e->getMessage());
            }
        }
        $this->assertSame([], $backend->calls());
    }

    public function testQueryParamsExtendAQueryAlreadyInThePath(): void
    {
        $backend = (new MockBackend())->on(200, [])->on(200, []);
        $client = $backend->makeClient();

        $client->request('GET', '/api/anything?a=1', ['b' => 2, 'skip' => null]);
        $this->assertSame('/api/anything', $backend->lastCall()['path']);
        $this->assertSame('a=1&b=2', $backend->lastCall()['query']);

        $client->request('GET', '/api/anything', ['q' => 'a b']);
        $this->assertSame('q=a%20b', $backend->lastCall()['query']);
    }
}
