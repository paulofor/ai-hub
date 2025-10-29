package com.aihub.hub.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.time.Clock;

@Configuration
public class AppConfig {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    public RestClient githubRestClient(@Value("${hub.github.api-url:https://api.github.com}") String apiUrl) {
        return RestClient.builder()
            .requestFactory(new JdkClientHttpRequestFactory())
            .baseUrl(apiUrl)
            .build();
    }

    @Bean
    public RestClient openAiRestClient(@Value("${hub.openai.api-url:https://api.openai.com}") String apiUrl) {
        return RestClient.builder()
            .requestFactory(new JdkClientHttpRequestFactory())
            .baseUrl(apiUrl)
            .build();
    }

    @Bean
    public RestClient codexRestClient(@Value("${hub.codex.api-url:https://api.openai.com}") String apiUrl) {
        return RestClient.builder()
            .requestFactory(new JdkClientHttpRequestFactory())
            .baseUrl(apiUrl)
            .build();
    }
}
