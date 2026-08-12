using System.Net;
using System.Net.Http.Headers;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using RppWebApi.Services;
using Xunit;

namespace RppWebApi.Tests;

public sealed class OutboundHttpResilienceTests
{
    [Fact]
    public async Task Get_Retries429AndHonorsRetryAfter()
    {
        var innerHandler = new SequenceHandler(
            CreateResponse(HttpStatusCode.TooManyRequests, TimeSpan.Zero),
            CreateResponse(HttpStatusCode.OK));
        using var client = CreateClient(innerHandler);

        var response = await client.GetAsync("https://graph.microsoft.com/v1.0/me");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2, innerHandler.CallCount);
    }

    [Fact]
    public async Task Get_StopsAfterConfiguredAttemptLimit()
    {
        var innerHandler = new SequenceHandler(
            CreateResponse(HttpStatusCode.ServiceUnavailable),
            CreateResponse(HttpStatusCode.ServiceUnavailable),
            CreateResponse(HttpStatusCode.ServiceUnavailable));
        using var client = CreateClient(innerHandler);

        var response = await client.GetAsync("https://graph.microsoft.com/v1.0/me");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal(3, innerHandler.CallCount);
    }

    [Fact]
    public async Task Post_IsNotRetried()
    {
        var innerHandler = new SequenceHandler(CreateResponse(HttpStatusCode.TooManyRequests));
        using var client = CreateClient(innerHandler);

        var response = await client.PostAsync(
            "https://graph.microsoft.com/v1.0/items",
            new StringContent("{}"));

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Equal(1, innerHandler.CallCount);
    }

    private static HttpClient CreateClient(HttpMessageHandler innerHandler)
    {
        return new HttpClient(new ResilientHttpMessageHandler(
            Options.Create(new OutboundHttpResilienceSettings
            {
                MaximumAttempts = 3,
                BaseDelayMilliseconds = 1,
                MaximumDelayMilliseconds = 5
            }),
            NullLogger<ResilientHttpMessageHandler>.Instance)
        {
            InnerHandler = innerHandler
        });
    }

    private static HttpResponseMessage CreateResponse(
        HttpStatusCode statusCode,
        TimeSpan? retryAfter = null)
    {
        var response = new HttpResponseMessage(statusCode);

        if (retryAfter.HasValue)
        {
            response.Headers.RetryAfter = new RetryConditionHeaderValue(retryAfter.Value);
        }

        return response;
    }

    private sealed class SequenceHandler(params HttpResponseMessage[] responses) : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _responses = new(responses);

        public int CallCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount++;
            return Task.FromResult(_responses.Dequeue());
        }
    }
}
