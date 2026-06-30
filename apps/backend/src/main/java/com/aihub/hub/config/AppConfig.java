package com.aihub.hub.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;
import java.time.Clock;
import java.time.Duration;

@Configuration
public class AppConfig {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    public RestClient githubRestClient(@Value("${hub.github.api-url:https://api.github.com}") String apiUrl) {
        return RestClient.builder()
            .requestFactory(jdkRequestFactory(Duration.ofSeconds(10), Duration.ofSeconds(30)))
            .baseUrl(apiUrl)
            .build();
    }

    @Bean
    public RestClient sandboxOrchestratorRestClient(
        @Value("${hub.sandbox.orchestrator.api-url:http://sandbox-orchestrator:8083}") String apiUrl,
        @Value("${hub.sandbox.orchestrator.connect-timeout-ms:5000}") long connectTimeoutMs,
        @Value("${hub.sandbox.orchestrator.read-timeout-ms:30000}") long readTimeoutMs
    ) {
        return RestClient.builder()
            .requestFactory(jdkRequestFactory(
                Duration.ofMillis(Math.max(1, connectTimeoutMs)),
                Duration.ofMillis(Math.max(1, readTimeoutMs))
            ))
            .baseUrl(apiUrl)
            .build();
    }

    private JdkClientHttpRequestFactory jdkRequestFactory(Duration connectTimeout, Duration readTimeout) {
        HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(connectTimeout)
            .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(readTimeout);
        return requestFactory;
    }
}
