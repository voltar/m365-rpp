using System.Net;
using Microsoft.Extensions.Options;

namespace RppWebApi.Services;

public sealed class OutboundHttpResilienceSettings
{
    public const string SectionName = "OutboundHttpResilience";

    public int MaximumAttempts { get; set; } = 3;
    public int BaseDelayMilliseconds { get; set; } = 250;
    public int MaximumDelayMilliseconds { get; set; } = 10_000;
}

public sealed class ResilientHttpMessageHandler : DelegatingHandler
{
    private static readonly HashSet<HttpMethod> RetryableMethods =
    [
        HttpMethod.Get,
        HttpMethod.Head,
        HttpMethod.Options
    ];

    private readonly OutboundHttpResilienceSettings _settings;
    private readonly ILogger<ResilientHttpMessageHandler> _logger;

    public ResilientHttpMessageHandler(
        IOptions<OutboundHttpResilienceSettings> settings,
        ILogger<ResilientHttpMessageHandler> logger)
    {
        _settings = settings.Value;
        _logger = logger;
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        if (!RetryableMethods.Contains(request.Method) || request.Content is not null)
        {
            return await base.SendAsync(request, cancellationToken);
        }

        var maximumAttempts = Math.Max(1, _settings.MaximumAttempts);

        for (var attempt = 1; attempt <= maximumAttempts; attempt++)
        {
            var attemptRequest = CloneRequest(request);
            var response = await base.SendAsync(attemptRequest, cancellationToken);

            if (!IsRetryable(response.StatusCode) || attempt == maximumAttempts)
            {
                return response;
            }

            var delay = CalculateDelay(response, attempt);
            _logger.LogWarning(
                "Transient HTTP {StatusCode} from {RequestUri}; retrying attempt {NextAttempt}/{MaximumAttempts} after {Delay}.",
                (int)response.StatusCode,
                request.RequestUri,
                attempt + 1,
                maximumAttempts,
                delay);

            response.Dispose();
            attemptRequest.Dispose();
            await Task.Delay(delay, cancellationToken);
        }

        throw new InvalidOperationException("HTTP retry loop ended without a response.");
    }

    private TimeSpan CalculateDelay(HttpResponseMessage response, int attempt)
    {
        var retryAfter = response.Headers.RetryAfter;
        var maximumDelay = TimeSpan.FromMilliseconds(Math.Max(0, _settings.MaximumDelayMilliseconds));

        if (retryAfter?.Delta is { } delta)
        {
            return delta <= maximumDelay ? delta : maximumDelay;
        }

        if (retryAfter?.Date is { } date)
        {
            var dateDelay = date - DateTimeOffset.UtcNow;
            var boundedDateDelay = dateDelay > TimeSpan.Zero ? dateDelay : TimeSpan.Zero;
            return boundedDateDelay <= maximumDelay ? boundedDateDelay : maximumDelay;
        }

        var baseDelay = Math.Max(0, _settings.BaseDelayMilliseconds);
        var exponentialDelay = baseDelay * Math.Pow(2, Math.Max(0, attempt - 1));
        var jitter = exponentialDelay * 0.2 * Random.Shared.NextDouble();
        return TimeSpan.FromMilliseconds(Math.Min(exponentialDelay + jitter, maximumDelay.TotalMilliseconds));
    }

    private static bool IsRetryable(HttpStatusCode statusCode)
    {
        return statusCode is HttpStatusCode.TooManyRequests
            or HttpStatusCode.BadGateway
            or HttpStatusCode.ServiceUnavailable
            or HttpStatusCode.GatewayTimeout;
    }

    private static HttpRequestMessage CloneRequest(HttpRequestMessage request)
    {
        var clone = new HttpRequestMessage(request.Method, request.RequestUri)
        {
            Version = request.Version,
            VersionPolicy = request.VersionPolicy
        };

        foreach (var header in request.Headers)
        {
            clone.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        return clone;
    }
}

public static class OutboundHttpResilienceExtensions
{
    public static IHttpClientBuilder AddRppResilience(this IHttpClientBuilder builder)
    {
        return builder.AddHttpMessageHandler<ResilientHttpMessageHandler>();
    }
}
