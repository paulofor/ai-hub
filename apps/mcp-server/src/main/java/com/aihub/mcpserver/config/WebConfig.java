package com.aihub.mcpserver.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@EnableConfigurationProperties(McpServerProperties.class)
public class WebConfig implements WebMvcConfigurer {

    private final BearerTokenInterceptor bearerTokenInterceptor;

    public WebConfig(BearerTokenInterceptor bearerTokenInterceptor) {
        this.bearerTokenInterceptor = bearerTokenInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(bearerTokenInterceptor)
                .addPathPatterns("/mcp/tools/**");
    }
}
